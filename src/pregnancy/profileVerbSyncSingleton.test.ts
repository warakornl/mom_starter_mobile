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

import { dispatchProfileVerbEntry } from './profileVerbSyncSingleton';
import type { ProfileVerbEntry } from './profileVerbQueue';
import type { PregnancyClient } from './pregnancyApiClient';
import type { PregnancyProfile } from './types';

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
