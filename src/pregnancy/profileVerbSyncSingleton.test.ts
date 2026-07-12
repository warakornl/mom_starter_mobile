/**
 * profileVerbSyncSingleton — unit tests (TDD, written BEFORE the implementation).
 *
 * Mirrors ../consent/consentSync.ts's module-level singleton wiring
 * (configureProfileVerbQueueStorage / restoreProfileVerbQueue /
 * resetProfileVerbQueue / drainProfileVerbQueue), but for profileVerbQueue.
 *
 * Also tests `dispatchProfileVerbEntry` — the REAL mapping from a
 * ProfileVerbEntry to the exact pregnancyApiClient verb call (this is the
 * production `dispatch` fn wired into profileVerbSync.drain). Verifies:
 *   - loss_event -> client.recordLossEvent(body, token, ifMatch, entry.clientDate)
 *   - reopen -> client.reopenPregnancy(token, ifMatch)
 *   - birth_event -> client.recordBirthEvent(body, token, ifMatch, entry.clientDate)
 *   - edit_profile -> client.putProfile(body, token, ifMatch, entry.clientDate)
 *   - Idempotency-Key: this pass does NOT yet have OR-BACKEND-1 wired
 *     server-side (per architecture §4.3, deferred-but-safe); the entry's
 *     idempotencyKey is threaded through to the client call so the header
 *     can be added the moment the client function accepts it (documented
 *     TODO, not a silent gap — see profileVerbSyncSingleton.ts).
 *   - result mapping: ok -> {kind:'200'}, 409 -> {kind:'409', currentProfile},
 *     403 consent_required -> {kind:'403'}, network/other -> {kind:'network'}.
 */

import {
  dispatchProfileVerbEntry,
  profileVerbQueue,
  resetProfileVerbQueue,
  resetProfileVerbSyncEngine,
  drainProfileVerbQueue,
} from './profileVerbSyncSingleton';
import type { ProfileVerbEntry } from './profileVerbQueue';
import type { PregnancyClient } from './pregnancyApiClient';
import type { PregnancyProfile } from './types';
import type { TokenStorage } from '../auth/tokenStorage';

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'profile-1', version: 6, edd: '2026-06-01', eddBasis: 'due_date',
    lifecycle: 'pregnant', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    gestationalWeek: 10, gestationalDay: 2, daysRemaining: 100, progress: 0.3,
    currentStage: 'T1', deliveryWindowActive: false,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ProfileVerbEntry> = {}): ProfileVerbEntry {
  return {
    id: 'entry-1', verb: 'loss_event', seq: 1, targetProfileId: 'profile-1',
    baseVersion: 5, idempotencyKey: 'idem-1', body: {}, clientDate: '2026-01-05',
    intendedLifecycle: 'ended', addedAt: Date.now(), attemptCount: 0, nextRetryAt: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('dispatchProfileVerbEntry', () => {
  it('loss_event calls client.recordLossEvent with the entry body/token/ifMatch/clientDate', async () => {
    const recordLossEvent = jest.fn(async () => ({ ok: true, profile: makeProfile({ lifecycle: 'ended' }) }));
    const client = { recordLossEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'loss_event', body: { lossDate: '2026-01-01' } });

    const result = await dispatchProfileVerbEntry(entry, '7', client, 'tok-abc');

    expect(recordLossEvent).toHaveBeenCalledWith({ lossDate: '2026-01-01' }, 'tok-abc', '7', '2026-01-05');
    expect(result.kind).toBe('200');
  });

  it('reopen calls client.reopenPregnancy with token/ifMatch (no body)', async () => {
    const reopenPregnancy = jest.fn(async () => ({ ok: true, profile: makeProfile({ lifecycle: 'pregnant' }) }));
    const client = { reopenPregnancy } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'reopen', intendedLifecycle: 'pregnant', body: {} });

    const result = await dispatchProfileVerbEntry(entry, '9', client, 'tok-abc');

    expect(reopenPregnancy).toHaveBeenCalledWith('tok-abc', '9');
    expect(result.kind).toBe('200');
  });

  it('birth_event calls client.recordBirthEvent with body/token/ifMatch/clientDate', async () => {
    const recordBirthEvent = jest.fn(async () => ({ ok: true, profile: makeProfile({ lifecycle: 'postpartum' }) }));
    const client = { recordBirthEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'birth_event', intendedLifecycle: 'postpartum', body: { birthDate: '2026-01-05' } });

    const result = await dispatchProfileVerbEntry(entry, '9', client, 'tok-abc');

    expect(recordBirthEvent).toHaveBeenCalledWith({ birthDate: '2026-01-05' }, 'tok-abc', '9', '2026-01-05');
    expect(result.kind).toBe('200');
  });

  it('edit_profile calls client.putProfile with body/token/ifMatch/clientDate', async () => {
    const putProfile = jest.fn(async () => ({ ok: true, profile: makeProfile({ edd: '2026-08-01' }), created: false }));
    const client = { putProfile } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'edit_profile', intendedLifecycle: null, body: { edd: '2026-08-01' } });

    const result = await dispatchProfileVerbEntry(entry, '9', client, 'tok-abc');

    expect(putProfile).toHaveBeenCalledWith({ edd: '2026-08-01' }, 'tok-abc', '9', '2026-01-05');
    expect(result.kind).toBe('200');
  });

  it('maps a 409 result to {kind:"409", currentProfile}', async () => {
    const currentProfile = makeProfile({ version: 8, lifecycle: 'ended' });
    const recordLossEvent = jest.fn(async () => ({
      ok: false, status: 409, code: 'version_conflict', message: 'x', currentProfile,
    }));
    const client = { recordLossEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'loss_event' });

    const result = await dispatchProfileVerbEntry(entry, '7', client, 'tok-abc');

    expect(result).toEqual({ kind: '409', currentProfile });
  });

  it('maps a 403 consent_required result to {kind:"403"}', async () => {
    const recordLossEvent = jest.fn(async () => ({
      ok: false, status: 403, code: 'consent_required', message: 'x',
    }));
    const client = { recordLossEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'loss_event' });

    const result = await dispatchProfileVerbEntry(entry, '7', client, 'tok-abc');

    expect(result).toEqual({ kind: '403' });
  });

  it('maps any other error status (e.g. 500) to {kind:"network"} (backoff-retry, not give-up)', async () => {
    const recordLossEvent = jest.fn(async () => ({
      ok: false, status: 500, code: 'internal_error', message: 'x',
    }));
    const client = { recordLossEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'loss_event' });

    const result = await dispatchProfileVerbEntry(entry, '7', client, 'tok-abc');

    expect(result).toEqual({ kind: 'network' });
  });

  it('maps 400/422 to {kind:"malformed"} (give-up path, §9 — should be unreachable given confirm-time validation)', async () => {
    const recordLossEvent = jest.fn(async () => ({
      ok: false, status: 422, code: 'loss_date_range', message: 'x',
    }));
    const client = { recordLossEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'loss_event' });

    const result = await dispatchProfileVerbEntry(entry, '7', client, 'tok-abc');

    expect(result).toEqual({ kind: 'malformed' });
  });

  it('a thrown network exception maps to {kind:"network"} (never throws out of dispatch)', async () => {
    const recordLossEvent = jest.fn(async () => { throw new Error('network down'); });
    const client = { recordLossEvent } as unknown as PregnancyClient;
    const entry = makeEntry({ verb: 'loss_event' });

    const result = await dispatchProfileVerbEntry(entry, '7', client, 'tok-abc');

    expect(result).toEqual({ kind: 'network' });
  });
});

// ─── resetProfileVerbQueue must ALSO clear the sync engine (appsec #B) ────────
//
// The comment on resetProfileVerbSyncEngine claimed "Production logout calls
// this alongside resetProfileVerbQueue" — but no production call site ever
// did (RootNavigator's logout only called resetProfileVerbQueue). Not a data
// leak (the queue itself was already cleared), but a real staleness bug: the
// engine's liveVersions/liveLifecycles Maps (keyed by targetProfileId) would
// survive a logout, so if a NEXT user's profile happened to reuse the same
// profile id (or the dev/test seed data does), a stale adopted version/
// lifecycle from the PREVIOUS user could be used to seed resolveIfMatch.
//
// Fix: resetProfileVerbQueue() now also calls resetProfileVerbSyncEngine().
// This test proves it via observable behavior (no internal getter exists):
// drain once so the engine adopts version=99/lifecycle='ended' for
// targetProfileId; call resetProfileVerbQueue(); drain a FRESH entry for the
// SAME targetProfileId with liveProfileVersion=5 — the If-Match header sent
// must be "5" (freshly seeded), never "99" (the stale adopted version), which
// is only possible if the engine itself (not just the queue) was reset.

function fakeTokenStorage(accessToken: string | null): TokenStorage {
  return {
    load: async () => (accessToken ? { accessToken, refreshToken: 'r' } : null),
    save: async () => {},
    clear: async () => {},
  } as TokenStorage;
}

describe('resetProfileVerbQueue — also clears the sync engine (fail-on-revert)', () => {
  beforeEach(async () => {
    await resetProfileVerbQueue();
    resetProfileVerbSyncEngine();
  });

  it('a stale adopted liveVersion does NOT survive resetProfileVerbQueue()', async () => {
    // 1. Drain a first entry; the engine adopts version=99/lifecycle='ended'.
    profileVerbQueue.enqueue({
      verb: 'loss_event',
      targetProfileId: 'profile-reset-1',
      baseVersion: 5,
      body: { lossDate: '2026-01-01' },
      clientDate: '2026-01-01',
      intendedLifecycle: 'ended',
    });
    await profileVerbQueue.persist();

    const firstFetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'profile-reset-1', version: 99, edd: '2026-02-10', eddBasis: 'due_date',
          lifecycle: 'ended', birthDate: null,
          createdAt: '2025-06-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          gestationalWeek: null, gestationalDay: null, daysRemaining: null,
          progress: null, currentStage: 'T3', deliveryWindowActive: false,
        }),
        { status: 200 },
      ),
    );

    await drainProfileVerbQueue(
      fakeTokenStorage('tok'),
      'https://api.test',
      5,
      { onAdopt: () => {} },
      firstFetch,
    );

    expect(profileVerbQueue.getEntries()).toHaveLength(0);

    // 2. Logout: reset the queue (this must ALSO reset the sync engine).
    await resetProfileVerbQueue();

    // 3. A fresh "user" (or same profile id re-seeded) enqueues a NEW entry
    //    for the SAME targetProfileId with liveProfileVersion=5 (its real
    //    current version). If the engine was NOT reset, resolveIfMatch would
    //    still return the stale adopted "99" instead of freshly seeding "5".
    profileVerbQueue.enqueue({
      verb: 'edit_profile',
      targetProfileId: 'profile-reset-1',
      baseVersion: 5,
      body: { edd: '2026-09-01' },
      clientDate: '2026-01-02',
      intendedLifecycle: null,
    });
    await profileVerbQueue.persist();

    let sentIfMatch: string | null = null;
    const secondFetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      sentIfMatch = headers?.['If-Match'] ?? null;
      return new Response(
        JSON.stringify({
          id: 'profile-reset-1', version: 6, edd: '2026-09-01', eddBasis: 'due_date',
          lifecycle: 'pregnant', birthDate: null,
          createdAt: '2025-06-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
          gestationalWeek: 5, gestationalDay: 0, daysRemaining: 200,
          progress: 0.1, currentStage: 'T1', deliveryWindowActive: false,
        }),
        { status: 200 },
      );
    });

    await drainProfileVerbQueue(
      fakeTokenStorage('tok'),
      'https://api.test',
      5,
      { onAdopt: () => {} },
      secondFetch,
    );

    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(sentIfMatch).toBe('"5"');
    expect(sentIfMatch).not.toBe('"99"');
  });
});
