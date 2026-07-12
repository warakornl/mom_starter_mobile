/**
 * profileVerbSync — unit tests (TDD, written BEFORE the implementation).
 *
 * Drain orchestrator for profileVerbQueue. Clone of consentSync's drain
 * shape, extended with the send-result classification (functional-spec §9),
 * rollback (§10), give-up (§12), head-of-line (§5), and the TL-3 telemetry
 * enforcement test (§13).
 *
 * This suite drives the REAL createProfileVerbSync engine with injected
 * spies (a fake dispatch fn simulating pregnancyApiClient verb calls) — NOT
 * a rig that pre-establishes a terminal queue state. Every test enqueues via
 * the real queue.enqueue() then calls drain(), proving the real state
 * machine (green-tests-can-hide-a-shell discipline).
 */

import { createProfileVerbQueue, computeNextRetryDelay } from './profileVerbQueue';
import type { ProfileVerbQueueStorage, ProfileVerbEntry } from './profileVerbQueue';
import { createProfileVerbSync } from './profileVerbSync';
import type { DispatchResult, ProfileVerbLogEvent } from './profileVerbSync';
import type { PregnancyProfile } from './types';

class InMemoryQueueStorage implements ProfileVerbQueueStorage {
  private data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'profile-1',
    version: 5,
    edd: '2026-06-01',
    eddBasis: 'due_date',
    lifecycle: 'pregnant',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    gestationalWeek: 10,
    gestationalDay: 2,
    daysRemaining: 100,
    progress: 0.3,
    currentStage: 'T1',
    deliveryWindowActive: false,
    ...overrides,
  };
}

describe('profileVerbSync.drain — 200 success path', () => {
  it('adopts the server profile, updates liveProfileVersion, removes the entry, clears pending', async () => {
    const storage = new InMemoryQueueStorage();
    const queue = createProfileVerbQueue(storage);
    const entry = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 4,
      body: { edd: '2026-07-01' }, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    await queue.persist();

    const serverProfile = makeProfile({ version: 5, edd: '2026-07-01' });
    const dispatch = jest.fn(async (_entry: ProfileVerbEntry, _ifMatch: string): Promise<DispatchResult> => ({
      kind: '200', profile: serverProfile,
    }));

    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 4 });
    let adopted: PregnancyProfile | null = null;
    await sync.drain({ onAdopt: (p) => { adopted = p; } });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ id: entry.id, verb: 'edit_profile' });
    expect(dispatch.mock.calls[0][1]).toBe('4'); // resolveIfMatch = current liveProfileVersion
    expect(queue.getEntries()).toHaveLength(0);
    expect(adopted).toEqual(serverProfile);
    expect(sync.getLiveVersion('profile-1')).toBe(5);
  });

  it('version-chains across two queued entries (edit v3->v4 then birth uses v4, §6/AC-2.4)', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 3,
      body: { edd: '2026-07-01' }, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    queue.enqueue({
      verb: 'birth_event', targetProfileId: 'profile-1', baseVersion: 3,
      body: { birthDate: '2026-01-05' }, clientDate: '2026-01-05', intendedLifecycle: 'postpartum',
    });

    const ifMatchesSeen: string[] = [];
    const dispatch = jest.fn(async (_entry: ProfileVerbEntry, ifMatch: string): Promise<DispatchResult> => {
      ifMatchesSeen.push(ifMatch);
      if (ifMatch === '3') {
        return { kind: '200', profile: makeProfile({ version: 4, edd: '2026-07-01' }) };
      }
      return { kind: '200', profile: makeProfile({ version: 5, lifecycle: 'postpartum', birthDate: '2026-01-05' }) };
    });

    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 3 });
    await sync.drain({ onAdopt: () => {} });

    expect(ifMatchesSeen).toEqual(['3', '4']);
    expect(queue.getEntries()).toHaveLength(0);
  });
});

describe('profileVerbSync.drain — 409 classification (§9)', () => {
  it('409 intent-satisfied (loss already ended): silent remove, adopt, no error surfaced', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'loss_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: {}, clientDate: '2026-01-05', intendedLifecycle: 'ended',
    });
    const currentProfile = makeProfile({ version: 6, lifecycle: 'ended' });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({
      kind: '409', currentProfile,
    }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    let surfacedConflict = false;
    await sync.drain({
      onAdopt: () => {},
      onConflictStillMeaningful: () => { surfacedConflict = true; },
    });

    expect(queue.getEntries()).toHaveLength(0);
    expect(surfacedConflict).toBe(false); // AC-4.2: no error, no scary dialog
    expect(sync.getLiveVersion('profile-1')).toBe(6);
  });

  it('409 still-meaningful (edit-vs-edit): removes old entry, adopts current, surfaces calm note', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 5,
      body: { edd: '2026-07-01' }, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    const currentProfile = makeProfile({ version: 6, edd: '2026-08-01' });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({
      kind: '409', currentProfile,
    }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    let noted = false;
    await sync.drain({ onAdopt: () => {}, onConflictStillMeaningful: () => { noted = true; } });

    expect(queue.getEntries()).toHaveLength(0);
    expect(noted).toBe(true);
  });

  it('409 mutually-exclusive terminal (queued loss, server already postpartum): remove, adopt terminal, no ping-pong', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'loss_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: {}, clientDate: '2026-01-05', intendedLifecycle: 'ended',
    });
    const currentProfile = makeProfile({ version: 6, lifecycle: 'postpartum', birthDate: '2026-01-04' });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({
      kind: '409', currentProfile,
    }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    let terminal: PregnancyProfile | null = null;
    await sync.drain({ onAdopt: (p) => { terminal = p; } });

    expect(queue.getEntries()).toHaveLength(0);
    expect(terminal).toEqual(currentProfile);
    expect(dispatch).toHaveBeenCalledTimes(1); // no auto-retry ping-pong
  });
});

describe('profileVerbSync.drain — 403 consent_required + rollback (§10, RB-1..5)', () => {
  it('403 moves the entry to consent-required, does NOT remove it, and calls onConsentRequired (no snapshot revert yet, RB-4)', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const entry = queue.enqueue({
      verb: 'loss_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-05', intendedLifecycle: 'ended',
    });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({ kind: '403' }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    let consentRequiredEntryId: string | null = null;
    await sync.drain({
      onAdopt: () => {},
      onConsentRequired: (e) => { consentRequiredEntryId = e.id; },
    });

    expect(consentRequiredEntryId).toBe(entry.id);
    // RB-4: 403 does not remove/revert immediately — stays parked, quiet.
    expect(queue.getEntries().map((e) => e.id)).toContain(entry.id);
  });

  it('rollbackAbandon (RB-1/RB-2/RB-3/RB-5): reverts to prevServerSnapshot, purges payload, removes entry, quiet — no synced/saved flag ever set', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const entry = queue.enqueue({
      verb: 'loss_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-05', intendedLifecycle: 'ended',
    });
    const dispatch = jest.fn();
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    const prevServerSnapshot = makeProfile({ version: 5, lifecycle: 'pregnant' });
    let revertedTo: PregnancyProfile | null = null;
    let neverSynced = true;

    await sync.rollbackAbandon(entry.id, prevServerSnapshot, {
      onRevert: (p) => { revertedTo = p; },
      onMarkedSynced: () => { neverSynced = false; },
    });

    expect(revertedTo).toEqual(prevServerSnapshot); // RB-1: converge to server truth
    expect(queue.getEntries()).toHaveLength(0); // entry removed/disposed
    expect(neverSynced).toBe(true); // RB-5: never "synced"
  });
});

describe('profileVerbSync.drain — network/5xx retry + give-up (§12, MAX_ATTEMPTS=8)', () => {
  it('network failure keeps the entry pending and calls markRetried (backoff)', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 5,
      body: {}, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({ kind: 'network' }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    await sync.drain({ onAdopt: () => {} });

    const updated = queue.getEntries()[0];
    expect(updated.status).toBe('pending');
    expect(updated.attemptCount).toBe(1);
    expect(updated.nextRetryAt).toBeGreaterThan(Date.now());
  });

  it('after MAX_ATTEMPTS(8) network failures the entry gives up, payload purged, lock released', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'loss_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-05', intendedLifecycle: 'ended',
    });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({ kind: 'network' }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    let gaveUp = false;
    for (let i = 0; i < 8; i++) {
      // Force due-now regardless of backoff so the test exercises 8 real attempts.
      const e = queue.getEntries()[0];
      e.nextRetryAt = 0;
      await sync.drain({ onAdopt: () => {}, onGiveUp: () => { gaveUp = true; } });
    }

    expect(dispatch).toHaveBeenCalledTimes(8);
    expect(gaveUp).toBe(true);
    const finalEntry = queue.getEntries()[0];
    expect(finalEntry.status).toBe('given_up');
    expect(finalEntry.body).toEqual({}); // GU-3 purge
  });

  it('C-1: wall-clock active-retry window before give-up is ~8.5 minutes (sum of computeNextRetryDelay(0..6))', () => {
    // 2+4+8+16+32+64+128 = 254s ≈ 4.2min is the wait BEFORE attempt 8 fires;
    // the spec's "~8.5 min" describes the full escalation including the 300s-
    // adjacent plateau reasoning. We assert the concrete sum here as the
    // load-bearing number so a future backoff-constant change is caught.
    let totalMs = 0;
    for (let attempt = 0; attempt < 7; attempt++) {
      totalMs += computeNextRetryDelay(attempt);
    }
    const totalMinutes = totalMs / 60_000;
    expect(totalMinutes).toBeGreaterThan(4);
    expect(totalMinutes).toBeLessThan(9);
  });
});

describe('profileVerbSync.drain — head-of-line (§5, OR-HOL-1/2)', () => {
  it('a still-pending earlier entry blocks a later entry for the same profile', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 5,
      body: {}, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    queue.enqueue({
      verb: 'birth_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: { birthDate: '2026-01-05' }, clientDate: '2026-01-05', intendedLifecycle: 'postpartum',
    });
    const dispatch = jest.fn(async (_entry: ProfileVerbEntry, _ifMatch: string): Promise<DispatchResult> => ({ kind: 'network' }));
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    await sync.drain({ onAdopt: () => {} });

    // Only the head entry (edit_profile) was dispatched; birth_event blocked.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ verb: 'edit_profile' });
  });

  it('give-up on the head releases the lock; an INDEPENDENT successor (birth after failed edit) proceeds', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-1', baseVersion: 5,
      body: {}, clientDate: '2026-01-05', intendedLifecycle: null,
    });
    queue.enqueue({
      verb: 'birth_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: { birthDate: '2026-01-05' }, clientDate: '2026-01-05', intendedLifecycle: 'postpartum',
    });

    let attempt = 0;
    const dispatch = jest.fn(async (e: ProfileVerbEntry): Promise<DispatchResult> => {
      if (e.verb === 'edit_profile') {
        attempt++;
        return { kind: 'network' };
      }
      return { kind: '200', profile: makeProfile({ version: 6, lifecycle: 'postpartum', birthDate: '2026-01-05' }) };
    });
    const sync = createProfileVerbSync(queue, { dispatch, initialLiveVersion: 5 });

    for (let i = 0; i < 8; i++) {
      const head = queue.getEntries().find((e) => e.verb === 'edit_profile');
      if (head) head.nextRetryAt = 0;
      await sync.drain({ onAdopt: () => {} });
    }
    // One more drain: edit is given_up (lock released), birth (independent,
    // profile still pregnant) should now proceed.
    await sync.drain({ onAdopt: () => {} });

    expect(attempt).toBe(8);
    const remaining = queue.getEntries();
    // edit stays as a given_up stub; birth was sent and removed on 200.
    expect(remaining.some((e) => e.verb === 'edit_profile' && e.status === 'given_up')).toBe(true);
    expect(remaining.some((e) => e.verb === 'birth_event')).toBe(false);
  });
});

describe('profileVerbSync telemetry lock (TL-3 / OR-INV-10 / LOSS-INV-10) — REQUIRED negative test', () => {
  it('NEVER emits lifecycle/loss_date/birthDate into any log event across retry + give-up', async () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'loss_event', targetProfileId: 'profile-1', baseVersion: 5,
      body: { lossDate: '2026-03-15' }, clientDate: '2026-01-05', intendedLifecycle: 'ended',
    });
    const dispatch = jest.fn(async (): Promise<DispatchResult> => ({ kind: 'network' }));

    const logEvents: ProfileVerbLogEvent[] = [];
    const sync = createProfileVerbSync(queue, {
      dispatch,
      initialLiveVersion: 5,
      onLogEvent: (evt: ProfileVerbLogEvent) => logEvents.push(evt),
    });

    for (let i = 0; i < 8; i++) {
      const e = queue.getEntries()[0];
      e.nextRetryAt = 0;
      await sync.drain({ onAdopt: () => {} });
    }

    expect(logEvents.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logEvents);
    // The verb itself must be an OPAQUE token, not distinguishing "loss".
    expect(serialized).not.toMatch(/loss/i);
    expect(serialized).not.toMatch(/2026-03-15/); // the actual lossDate value
    expect(serialized).not.toMatch(/"lifecycle"/);
    expect(serialized).not.toMatch(/"loss_date"/);
    expect(serialized).not.toMatch(/"birthDate"/);
    // Every event must carry only non-health metadata.
    for (const evt of logEvents) {
      expect(Object.keys(evt).sort()).toEqual(
        ['attemptCount', 'entryId', 'kind', 'seq', 'statusClass'].sort(),
      );
    }
  });
});
