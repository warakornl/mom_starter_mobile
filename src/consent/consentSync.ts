/**
 * consentSync — durable offline queue + drain orchestrator.
 *
 * Implements first-run-consent.md §4.2 (durable queue + exponential retry):
 * - The consent queue is backed by injectable durable storage (configured at
 *   app startup via App.tsx using expo-secure-store).
 * - `drainConsentQueue` processes due entries via POST /v1/account/consents:
 *   success → remove entry; failure → markRetried (backoff). Persists after
 *   each mutation so the queue state survives the next app kill.
 * - Call drain on AppState 'active' (foreground) to retry without adding heavy
 *   dependencies (NetInfo not required).
 *
 * Architecture:
 * - `createConsentSync(storage, apiClient?)` — testable factory used in tests.
 * - `consentQueue` — module-level singleton backed by a _StorageProxy.
 * - `configureConsentQueueStorage(storage)` — wire durable storage at startup.
 * - `drainConsentQueue(tokenStorage, apiBaseUrl)` — the production drain function.
 *
 * SECURITY: entries hold only consent metadata (type, granted bool, version).
 * No health data, no tokens stored in the queue.
 */

import { createConsentQueue } from './consentQueue';
import type { ConsentQueueStorage, ConsentQueue } from './consentQueue';
import { consentStore } from './consentStore';
import { createConsentApiClient } from './consentApiClient';
import type { ConsentApiClient } from './consentApiClient';
import type { TokenStorage } from '../auth/tokenStorage';

// ─── Injectable factory (for tests) ──────────────────────────────────────────

/**
 * Testable factory: creates an isolated (queue, drain) pair.
 * Tests inject an in-memory storage and a mock API client.
 * Production uses the module-level `consentQueue` / `drainConsentQueue`.
 *
 * @param storage    - injectable queue storage (in-memory in tests, SecureStore in prod)
 * @param apiClient  - optional pre-built API client; if omitted, `drain` creates
 *                     one from `apiBaseUrl` on each invocation
 */
export function createConsentSync(
  storage: ConsentQueueStorage,
  apiClient?: Pick<ConsentApiClient, 'postConsent'>,
) {
  const queue = createConsentQueue(storage);
  let _restored = false;
  let _draining = false;

  /**
   * Drain due queue entries.
   * Called on AppState 'active' (foreground) or at the callers discretion.
   * Best-effort: never throws.
   *
   * @param tokenStorage - to load the current access token
   * @param apiBaseUrl   - base URL for POST /v1/account/consents
   */
  async function drain(tokenStorage: TokenStorage, apiBaseUrl: string): Promise<void> {
    if (_draining) return;
    _draining = true;
    try {
      // Restore from durable storage once per session (survives app restarts)
      if (!_restored) {
        await queue.restore();
        _restored = true;
      }

      const tokens = await tokenStorage.load();
      if (!tokens) return;

      const client = apiClient ?? createConsentApiClient(apiBaseUrl);
      const due = queue.getDueEntries();

      for (const entry of due) {
        try {
          const result = await client.postConsent(
            entry.consentType,
            entry.granted,
            entry.consentTextVersion,
            tokens.accessToken,
          );
          if (result.ok) {
            queue.remove(entry.id);
            // Confirm local state with the server-verified record
            consentStore.setGranted(
              entry.consentType,
              entry.granted,
              entry.consentTextVersion,
            );
          } else {
            queue.markRetried(entry.id);
          }
        } catch {
          // Network error for this single entry — mark retried, continue with rest
          queue.markRetried(entry.id);
        }
        // Persist after each entry so progress is not lost on app-kill mid-drain
        await queue.persist();
      }
    } catch {
      // Swallow top-level errors (tokenStorage.load() throws, etc.) — drain is best-effort
    } finally {
      _draining = false;
    }
  }

  /**
   * Restore durable queue entries into memory. Call once at app startup BEFORE
   * any enqueue/persist call so that `persist()` never clobbers un-restored entries
   * (N2 — startup clobber/data-loss race).
   *
   * Sets `_restored = true` so a subsequent `drain()` call skips the lazy restore
   * and does not double-restore.
   *
   * Idempotent: if already restored, this is a no-op.
   */
  async function restoreQueue(): Promise<void> {
    if (_restored) return;
    await queue.restore();
    _restored = true;
  }

  /**
   * Clear the durable consent queue (in-memory + persisted storage).
   * Call during logout so a subsequent user's foreground drain finds nothing
   * and cannot POST a previous user's consent entries under the new user's token
   * (N1 — cross-user consent contamination).
   *
   * Best-effort: any persist error is swallowed so logout is never blocked.
   */
  async function resetQueue(): Promise<void> {
    queue.clear();
    try {
      await queue.persist();
    } catch {
      // persist failure is non-fatal — in-memory is already cleared
    }
  }

  return { queue, drain, restoreQueue, resetQueue };
}

// ─── Storage proxy (allows configuring durable storage after module init) ──────

/**
 * Proxy so the durable storage binding can be swapped in at app startup
 * (App.tsx calls configureConsentQueueStorage) without requiring this module
 * to import expo-secure-store directly (which would break Jest tests).
 *
 * Until configured, the proxy uses an in-memory no-op (queue entries are
 * ephemeral — they survive re-mounts but not app restarts until App.tsx
 * runs configureConsentQueueStorage).
 */
class _ConsentQueueStorageProxy implements ConsentQueueStorage {
  private _inner: ConsentQueueStorage = {
    async save(_: string): Promise<void> { /* no-op until configured */ },
    async load(): Promise<string | null> { return null; },
  };

  configure(storage: ConsentQueueStorage): void {
    this._inner = storage;
  }

  async save(json: string): Promise<void> {
    return this._inner.save(json);
  }

  async load(): Promise<string | null> {
    return this._inner.load();
  }
}

// ─── Module-level singletons ──────────────────────────────────────────────────

const _storageProxy = new _ConsentQueueStorageProxy();
const _sync = createConsentSync(_storageProxy);

/**
 * Module-level durable consent queue.
 * Shared between ConsentScreen (enqueue) and drainConsentQueue (process).
 * Backed by a proxy; call configureConsentQueueStorage() at startup to wire
 * expo-secure-store (or any ConsentQueueStorage implementation).
 */
export const consentQueue: ConsentQueue = _sync.queue;

/**
 * Wire durable storage into the module-level queue (call once at app startup).
 *
 * Example (App.tsx):
 *   import * as SecureStore from 'expo-secure-store';
 *   configureConsentQueueStorage({
 *     save: (json) => SecureStore.setItemAsync('consent_queue_v1', json),
 *     load: () => SecureStore.getItemAsync('consent_queue_v1'),
 *   });
 */
export function configureConsentQueueStorage(storage: ConsentQueueStorage): void {
  _storageProxy.configure(storage);
}

/**
 * Restore the durable consent queue into memory at app startup.
 *
 * Call once in App.tsx right after `configureConsentQueueStorage()` so that
 * any `enqueue` + `persist` that fires before the first foreground cycle
 * appends to — rather than overwrites — the prior-session persisted entries
 * (N2 — startup clobber/data-loss race fix).
 *
 * Idempotent: a subsequent `drain()` call will see `_restored = true` and
 * skip its own lazy restore, so there is no double-restore.
 *
 * Fire-and-forget: `void restoreConsentQueue()` is fine. If storage fails,
 * the queue starts empty (no data loss — entries are retry metadata only).
 */
export async function restoreConsentQueue(): Promise<void> {
  return _sync.restoreQueue();
}

/**
 * Clear the durable consent queue (in-memory + persisted storage).
 *
 * Call during logout so a subsequent user's foreground drain finds an empty
 * queue and cannot POST a previous user's consent entries under the new
 * user's token (N1 — cross-user consent contamination fix, PDPA-legally-significant).
 *
 * Best-effort: any storage error is swallowed so logout is never blocked.
 */
export async function resetConsentQueue(): Promise<void> {
  return _sync.resetQueue();
}

/**
 * Drain due consent queue entries by POSTing to /v1/account/consents.
 *
 * Call on AppState 'active' (foreground) to retry queued consents.
 * Best-effort: never throws. If there are no due entries, or no tokens, returns immediately.
 *
 * On success: removes the entry from the queue and updates consentStore.
 * On failure: applies exponential backoff (markRetried).
 */
export async function drainConsentQueue(
  tokenStorage: TokenStorage,
  apiBaseUrl: string,
): Promise<void> {
  return _sync.drain(tokenStorage, apiBaseUrl);
}
