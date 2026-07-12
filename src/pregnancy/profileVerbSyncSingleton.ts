/**
 * profileVerbSyncSingleton — module-level wiring for profileVerbQueue/Sync.
 *
 * Mirrors ../consent/consentSync.ts's module-level singleton pattern
 * (configureConsentQueueStorage / restoreConsentQueue / resetConsentQueue /
 * drainConsentQueue) for the profile-verb adjunct queue.
 *
 * `dispatchProfileVerbEntry` is the REAL production mapping from a queued
 * ProfileVerbEntry to the exact pregnancyApiClient verb call — the thing
 * profileVerbSync.drain() calls as its `dispatch` fn.
 *
 * OR-BACKEND-1 note: the contract's Idempotency-Key transport wiring on the
 * four verb handlers is a tracked backend follow-up (architecture §4.3);
 * this client already carries a stable per-entry idempotencyKey (§3.1) ready
 * to send the moment pregnancyApiClient's verb functions accept an
 * `idempotencyKey` parameter. Until that backend wiring lands, the feature
 * is still safe via the content-no-op (layer 2) + If-Match (layer 3)
 * idempotency layers (architecture §4.2) — see the functional spec §8.
 *
 * Drain host (OR-STRUCT-1): profileVerbSync.drain() is called from
 * HomeTabScreen's existing AppState 'active' handler (same handler that
 * calls drainConsentQueue) + once at app startup — see homeTabScreen wiring
 * + App.tsx. This module does NOT invent its own scheduler/AppState listener
 * (NG-5 — no headless-while-killed background loop).
 *
 * SECURITY: NEVER log accessToken. The dispatch mapping passes entry.body
 * straight to the existing pregnancyApiClient functions (already-encrypted
 * ciphers per DR-1) — this module adds no new logging of health values.
 */

import { createProfileVerbQueue } from './profileVerbQueue';
import type { ProfileVerbQueueStorage, ProfileVerbEntry } from './profileVerbQueue';
import { createProfileVerbSync } from './profileVerbSync';
import type { DispatchResult } from './profileVerbSync';
import { createPregnancyClient } from './pregnancyApiClient';
import type { PregnancyClient } from './pregnancyApiClient';
import type {
  LossEventInput,
  BirthEventInput,
  PregnancyProfileInput,
} from './types';
import type { TokenStorage } from '../auth/tokenStorage';

// ─── Storage proxy (allows configuring durable storage after module init) ──
//
// Same shape as consentSync's _ConsentQueueStorageProxy — lets App.tsx wire
// expo-secure-store at startup without this module importing it directly
// (keeps Jest tests import-safe, mirrors the shipped pattern exactly).

class _ProfileVerbQueueStorageProxy implements ProfileVerbQueueStorage {
  private _inner: ProfileVerbQueueStorage = {
    async save(_: string): Promise<void> { /* no-op until configured */ },
    async load(): Promise<string | null> { return null; },
  };

  configure(storage: ProfileVerbQueueStorage): void {
    this._inner = storage;
  }

  async save(json: string): Promise<void> {
    return this._inner.save(json);
  }

  async load(): Promise<string | null> {
    return this._inner.load();
  }
}

const _storageProxy = new _ProfileVerbQueueStorageProxy();

/** Module-level durable queue — shared between confirm screens (enqueue) and
 * the drain host (HomeTabScreen). */
export const profileVerbQueue = createProfileVerbQueue(_storageProxy);

let _restored = false;

/**
 * Wire durable storage into the module-level queue (call once at app startup,
 * mirrors configureConsentQueueStorage in App.tsx).
 */
export function configureProfileVerbQueueStorage(storage: ProfileVerbQueueStorage): void {
  _storageProxy.configure(storage);
}

/**
 * Restore the durable profile-verb queue into memory at app startup.
 * Idempotent — mirrors restoreConsentQueue.
 */
export async function restoreProfileVerbQueue(): Promise<void> {
  if (_restored) return;
  await profileVerbQueue.restore();
  _restored = true;
}

/**
 * Clear the durable profile-verb queue (in-memory + persisted).
 * Wired into performLogout alongside resetConsentQueue (cross-user
 * contamination guard — a queued loss/birth/edit/reopen for User A must
 * never drain under User B's token after a logout/login).
 * Best-effort: any persist error is swallowed so logout is never blocked.
 */
export async function resetProfileVerbQueue(): Promise<void> {
  profileVerbQueue.clear();
  try {
    await profileVerbQueue.persist();
  } catch {
    // persist failure is non-fatal — in-memory is already cleared
  }
}

// ─── The real dispatch mapping (entry -> exact pregnancyApiClient call) ────

/**
 * Maps a queued ProfileVerbEntry to the exact pregnancyApiClient verb call
 * and classifies the result into the DispatchResult shape profileVerbSync
 * expects. Never throws — a thrown network exception is caught and mapped
 * to {kind:'network'} so drain()'s backoff/give-up logic always runs.
 */
export async function dispatchProfileVerbEntry(
  entry: ProfileVerbEntry,
  ifMatch: string,
  client: PregnancyClient,
  accessToken: string,
): Promise<DispatchResult> {
  try {
    switch (entry.verb) {
      case 'loss_event': {
        const result = await client.recordLossEvent(
          entry.body as LossEventInput,
          accessToken,
          ifMatch,
          entry.clientDate,
        );
        if (result.ok) return { kind: '200', profile: result.profile };
        if (result.status === 409 && 'currentProfile' in result) return { kind: '409', currentProfile: result.currentProfile };
        if (result.status === 403) return { kind: '403' };
        if (result.status === 400 || result.status === 422) return { kind: 'malformed' };
        return { kind: 'network' };
      }
      case 'reopen': {
        const result = await client.reopenPregnancy(accessToken, ifMatch);
        if (result.ok) return { kind: '200', profile: result.profile };
        if (result.status === 409 && 'currentProfile' in result) return { kind: '409', currentProfile: result.currentProfile };
        if (result.status === 403) return { kind: '403' };
        if (result.status === 400 || result.status === 422) return { kind: 'malformed' };
        return { kind: 'network' };
      }
      case 'birth_event': {
        const result = await client.recordBirthEvent(
          entry.body as unknown as BirthEventInput,
          accessToken,
          ifMatch,
          entry.clientDate,
        );
        if (result.ok) return { kind: '200', profile: result.profile };
        if (result.status === 403) return { kind: '403' };
        if (result.status === 400 || result.status === 422) return { kind: 'malformed' };
        // birth_event's result type has no 409-with-currentProfile variant
        // in today's client typing — treat any other non-ok as retryable
        // network to stay safe (never silently drop a queued birth).
        return { kind: 'network' };
      }
      case 'edit_profile': {
        const result = await client.putProfile(
          entry.body as PregnancyProfileInput,
          accessToken,
          ifMatch,
          entry.clientDate,
        );
        if (result.ok) return { kind: '200', profile: result.profile };
        if (result.status === 409 && 'currentProfile' in result) return { kind: '409', currentProfile: result.currentProfile };
        if (result.status === 403) return { kind: '403' };
        if (result.status === 400 || result.status === 422) return { kind: 'malformed' };
        return { kind: 'network' };
      }
      default:
        return { kind: 'network' };
    }
  } catch {
    // Network/offline exception — never throws out of dispatch.
    return { kind: 'network' };
  }
}

// ─── Production drain entrypoint ───────────────────────────────────────────
//
// One long-lived engine instance per JS session (module-level singleton) so
// liveProfileVersion/liveLifecycle adopted from a successful send PERSISTS
// across drain() calls (§6 version-chaining relies on this — a fresh engine
// per call would forget the version it just adopted). The dispatch fn is a
// thin indirection layer (`_currentDispatch`) so each drain call can bind
// the current token/client without recreating the whole engine.

let _currentDispatch: ((entry: ProfileVerbEntry, ifMatch: string) => Promise<DispatchResult>) | null = null;

let _sync: ReturnType<typeof createProfileVerbSync> | null = null;

function getSync(initialLiveVersion: number): ReturnType<typeof createProfileVerbSync> {
  if (!_sync) {
    _sync = createProfileVerbSync(profileVerbQueue, {
      dispatch: (entry, ifMatch) => {
        if (!_currentDispatch) return Promise.resolve({ kind: 'network' } as DispatchResult);
        return _currentDispatch(entry, ifMatch);
      },
      initialLiveVersion,
    });
  }
  return _sync;
}

/**
 * Reset the module-level sync engine (test-only escape hatch + logout hook).
 * Production logout calls this alongside resetProfileVerbQueue so a fresh
 * session starts with no stale adopted liveProfileVersion from a prior user.
 */
export function resetProfileVerbSyncEngine(): void {
  _sync = null;
  _currentDispatch = null;
}

/**
 * Drain due profile-verb queue entries by dispatching the real
 * pregnancyApiClient verb calls.
 *
 * Call from HomeTabScreen's AppState 'active' handler (same place as
 * drainConsentQueue) + once at app startup. Best-effort: never throws.
 *
 * @param tokenStorage    to load the current access token
 * @param apiBaseUrl      base URL for the pregnancy-profile verb endpoints
 * @param liveProfileVersion  seeds resolveIfMatch ONLY on the very first
 *   drain of this session; subsequent drains use the version this engine
 *   itself adopted from successful sends (§6) — passing a fresh GET-derived
 *   version here on later calls is harmless (it is only used if the engine
 *   has not yet seen this targetProfileId).
 * @param callbacks       onAdopt / onConflictStillMeaningful / onConsentRequired / onGiveUp
 */
export async function drainProfileVerbQueue(
  tokenStorage: TokenStorage,
  apiBaseUrl: string,
  liveProfileVersion: number,
  callbacks: Parameters<ReturnType<typeof createProfileVerbSync>['drain']>[0],
): Promise<void> {
  if (!_restored) {
    await profileVerbQueue.restore();
    _restored = true;
  }

  const tokens = await tokenStorage.load();
  if (!tokens?.accessToken) return;

  const client = createPregnancyClient(apiBaseUrl);
  const accessToken = tokens.accessToken;
  _currentDispatch = (entry, ifMatch) => dispatchProfileVerbEntry(entry, ifMatch, client, accessToken);

  const sync = getSync(liveProfileVersion);
  await sync.drain(callbacks);
}

export type { ProfileVerbSync } from './profileVerbSync';
