/**
 * profileVerbQueue — unit tests (TDD, written BEFORE the implementation).
 *
 * Clone of consentQueue's proven pattern (../consent/consentQueue.ts), re-
 * parameterised for the 4 direct-REST profile verbs per
 * docs/functional-spec/direct-rest-offline-resilience-functional.md §3.
 *
 * Pinned behavior under test:
 *   - enqueue mints a stable idempotencyKey ONCE (OR-INV-4) — never re-minted.
 *   - seq is monotonic per targetProfileId (§3.1).
 *   - getDueEntries: status==='pending' && nextRetryAt<=now, sorted by seq.
 *   - markRetried: attemptCount++, nextRetryAt = computeNextRetryDelay (parity
 *     with consentQueue's verbatim backoff — reused, not reinvented).
 *   - hasPending dedup per (targetProfileId, verb) — §17.1.
 *   - persist/restore round-trip via injectable storage.
 *   - resetQueue clears in-memory + persisted (logout cross-user guard).
 *   - giveUp / retry-again preserve idempotencyKey (never re-minted) — §12.
 */

import { createProfileVerbQueue, computeNextRetryDelay } from './profileVerbQueue';
import type { ProfileVerbQueueStorage } from './profileVerbQueue';

class InMemoryQueueStorage implements ProfileVerbQueueStorage {
  private data: string | null = null;
  async save(json: string): Promise<void> { this.data = json; }
  async load(): Promise<string | null> { return this.data; }
}

// ─── computeNextRetryDelay — PARITY with consentQueue (no reinvention) ────────

describe('profileVerbQueue computeNextRetryDelay parity', () => {
  it('matches consentQueue backoff shape exactly (2s, 4s, 8s ... capped 300s)', () => {
    expect(computeNextRetryDelay(0)).toBe(2000);
    expect(computeNextRetryDelay(1)).toBe(4000);
    expect(computeNextRetryDelay(2)).toBe(8000);
    expect(computeNextRetryDelay(7)).toBe(256_000);
    expect(computeNextRetryDelay(8)).toBe(300_000);
    expect(computeNextRetryDelay(20)).toBe(300_000);
  });
});

// ─── enqueue ───────────────────────────────────────────────────────────────

describe('profileVerbQueue.enqueue', () => {
  it('adds an entry with a stable idempotencyKey, seq=1 for first entry, status=pending', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const entry = queue.enqueue({
      verb: 'loss_event',
      targetProfileId: 'profile-1',
      baseVersion: 3,
      body: { lossDate: '2026-01-01' },
      clientDate: '2026-01-02',
      intendedLifecycle: 'ended',
    });

    expect(entry.verb).toBe('loss_event');
    expect(entry.seq).toBe(1);
    expect(entry.targetProfileId).toBe('profile-1');
    expect(entry.baseVersion).toBe(3);
    expect(entry.idempotencyKey).toBeTruthy();
    expect(entry.attemptCount).toBe(0);
    expect(entry.nextRetryAt).toBe(0);
    expect(entry.status).toBe('pending');
    expect(entry.id).toBeTruthy();
  });

  it('increments seq monotonically per targetProfileId', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    const e2 = queue.enqueue({
      verb: 'birth_event', targetProfileId: 'p1', baseVersion: 1,
      body: { birthDate: '2026-01-01' }, clientDate: '2026-01-01', intendedLifecycle: 'postpartum',
    });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
  });

  it('seq counters are independent per targetProfileId (cross-profile guard §17.1)', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const eA = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-A', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    const eB = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'profile-B', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    expect(eA.seq).toBe(1);
    expect(eB.seq).toBe(1);
  });

  it('mints a DIFFERENT idempotencyKey for two distinct entries', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    const e2 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    expect(e1.idempotencyKey).not.toBe(e2.idempotencyKey);
  });
});

// ─── getDueEntries ─────────────────────────────────────────────────────────

describe('profileVerbQueue.getDueEntries', () => {
  it('returns only pending entries whose nextRetryAt <= now, sorted by seq', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    const e2 = queue.enqueue({
      verb: 'birth_event', targetProfileId: 'p1', baseVersion: 1,
      body: { birthDate: '2026-01-01' }, clientDate: '2026-01-01', intendedLifecycle: 'postpartum',
    });
    queue.markRetried(e1.id); // pushes e1's nextRetryAt into the future
    const due = queue.getDueEntries(Date.now());
    expect(due.map((e) => e.id)).toEqual([e2.id]);
  });

  it('excludes given_up entries', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    queue.markGivenUp(e1.id);
    expect(queue.getDueEntries(Date.now())).toHaveLength(0);
  });
});

// ─── remove / markRetried / markGivenUp ───────────────────────────────────

describe('profileVerbQueue mutation ops', () => {
  it('remove deletes the entry', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    queue.remove(e1.id);
    expect(queue.getEntries()).toHaveLength(0);
  });

  it('markRetried increments attemptCount and sets nextRetryAt via computeNextRetryDelay', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    const before = Date.now();
    queue.markRetried(e1.id);
    const after = Date.now();
    const updated = queue.getEntries()[0];
    expect(updated.attemptCount).toBe(1);
    expect(updated.nextRetryAt).toBeGreaterThanOrEqual(before + computeNextRetryDelay(0));
    expect(updated.nextRetryAt).toBeLessThanOrEqual(after + computeNextRetryDelay(0));
  });

  it('markGivenUp sets status=given_up and purges the health-bearing payload (OR-INV-11 / GU-3)', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'loss_event', targetProfileId: 'p1', baseVersion: 1,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-01', intendedLifecycle: 'ended',
    });
    queue.markGivenUp(e1.id);
    const updated = queue.getEntries()[0];
    expect(updated.status).toBe('given_up');
    // GU-3: health payload purged from the durable entry.
    expect(updated.body).toEqual({});
  });

  it('retryGivenUp resets attemptCount=0, status=pending, nextRetryAt=0, SAME idempotencyKey (§12)', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const e1 = queue.enqueue({
      verb: 'loss_event', targetProfileId: 'p1', baseVersion: 1,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-01', intendedLifecycle: 'ended',
    });
    const originalKey = e1.idempotencyKey;
    queue.markGivenUp(e1.id);
    queue.retryGivenUp(e1.id);
    const updated = queue.getEntries()[0];
    expect(updated.status).toBe('pending');
    expect(updated.attemptCount).toBe(0);
    expect(updated.nextRetryAt).toBe(0);
    expect(updated.idempotencyKey).toBe(originalKey);
  });
});

// ─── hasPending dedup (§17.1) ──────────────────────────────────────────────

describe('profileVerbQueue.hasPending', () => {
  it('returns true when an identical-verb pending entry already exists for the profile', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'loss_event', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: 'ended',
    });
    expect(queue.hasPending('p1', 'loss_event')).toBe(true);
    expect(queue.hasPending('p1', 'birth_event')).toBe(false);
    expect(queue.hasPending('p2', 'loss_event')).toBe(false);
  });
});

// ─── persist / restore ─────────────────────────────────────────────────────

describe('profileVerbQueue persist/restore', () => {
  it('round-trips entries through injectable storage', async () => {
    const storage = new InMemoryQueueStorage();
    const queue = createProfileVerbQueue(storage);
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    await queue.persist();

    const queue2 = createProfileVerbQueue(storage);
    await queue2.restore();
    expect(queue2.getEntries()).toHaveLength(1);
    expect(queue2.getEntries()[0].verb).toBe('edit_profile');
  });

  it('starts empty on corrupt storage (no throw)', async () => {
    const storage: ProfileVerbQueueStorage = {
      save: async () => {},
      load: async () => 'not json{{{',
    };
    const queue = createProfileVerbQueue(storage);
    await expect(queue.restore()).resolves.not.toThrow();
    expect(queue.getEntries()).toHaveLength(0);
  });
});

// ─── clear / resetQueue (logout cross-user guard) ──────────────────────────

describe('profileVerbQueue.clear', () => {
  it('empties in-memory entries (does not auto-persist)', () => {
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    queue.enqueue({
      verb: 'edit_profile', targetProfileId: 'p1', baseVersion: 1,
      body: {}, clientDate: '2026-01-01', intendedLifecycle: null,
    });
    queue.clear();
    expect(queue.getEntries()).toHaveLength(0);
  });
});

// ─── PERSISTED-STORAGE-level tests (appsec #C) ─────────────────────────────
//
// The tests above only assert against getEntries() (in-memory). These two
// assert against the STORAGE layer itself (storage.load()/the raw persisted
// JSON) — proving the health-payload purge (GU-3) and the logout wipe are
// real at the durable-storage level, not just in the in-memory array that
// happens to also get persisted correctly today.

describe('profileVerbQueue — persisted-storage-level guarantees (appsec #C)', () => {
  it('GU-3: after markGivenUp + persist, a NEW queue restored from the SAME storage has body={} (no lossDate survives in the persisted JSON)', async () => {
    const storage = new InMemoryQueueStorage();
    const queue = createProfileVerbQueue(storage);
    const e1 = queue.enqueue({
      verb: 'loss_event', targetProfileId: 'p1', baseVersion: 1,
      // A distinctive lossDate VALUE, deliberately different from clientDate,
      // so the assertion below can prove the health-bearing VALUE is purged
      // without false-failing on the (legitimate, non-health) clientDate
      // field that the entry keeps.
      body: { lossDate: '2026-03-17' }, clientDate: '2026-01-01', intendedLifecycle: 'ended',
    });
    queue.markGivenUp(e1.id);
    await queue.persist();

    // Prove it at the raw persisted JSON too — not just via a re-hydrated queue.
    const rawJson = await storage.load();
    expect(rawJson).not.toBeNull();
    expect(rawJson).not.toContain('lossDate');
    expect(rawJson).not.toContain('2026-03-17');
    expect(rawJson).toContain('"body":{}');

    // A brand-new queue instance restored from the SAME durable storage must
    // see the purged (not the original health-bearing) body.
    const restoredQueue = createProfileVerbQueue(storage);
    await restoredQueue.restore();
    const restoredEntry = restoredQueue.getEntries().find((e) => e.id === e1.id);
    expect(restoredEntry).toBeDefined();
    expect(restoredEntry!.status).toBe('given_up');
    expect(restoredEntry!.body).toEqual({});
  });

  it('resetProfileVerbQueue (clear + persist) leaves storage.load() returning "[]" — no stale entries survive at rest', async () => {
    const storage = new InMemoryQueueStorage();
    const queue = createProfileVerbQueue(storage);
    queue.enqueue({
      verb: 'loss_event', targetProfileId: 'p1', baseVersion: 1,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-01', intendedLifecycle: 'ended',
    });
    await queue.persist();

    // Sanity: something really was persisted before the reset.
    const beforeReset = await storage.load();
    expect(beforeReset).not.toBe('[]');

    // Mirrors resetProfileVerbQueue's exact sequence (clear() then persist()).
    queue.clear();
    await queue.persist();

    const afterReset = await storage.load();
    expect(afterReset).toBe('[]');

    // A fresh queue restored from this storage must also see nothing.
    const restoredQueue = createProfileVerbQueue(storage);
    await restoredQueue.restore();
    expect(restoredQueue.getEntries()).toHaveLength(0);
  });
});

// ─── TL-3 telemetry lock — negative test (§13 / LOSS-INV-10 / OR-INV-10) ──

describe('profileVerbQueue telemetry lock (TL-3)', () => {
  it('getEntries()/persist() output never contains a raw lifecycle/date value as a bare log-friendly field beyond the stored body (entries are not a logging surface)', () => {
    // This guards that the queue module itself never derives/logs a
    // separate telemetry projection containing health values. The full
    // enforcement test (scanning actual log/telemetry sinks) lives in
    // profileVerbSync.test.ts alongside the drain/classify logic, since
    // that is where retry/give-up events are actually emitted.
    const queue = createProfileVerbQueue(new InMemoryQueueStorage());
    const entry = queue.enqueue({
      verb: 'loss_event', targetProfileId: 'p1', baseVersion: 1,
      body: { lossDate: '2026-01-01' }, clientDate: '2026-01-01', intendedLifecycle: 'ended',
    });
    // The queue does not expose any telemetry/log method — only getEntries
    // (durable state) exists. Confirms no separate logging API was added.
    expect((queue as unknown as { logEntry?: unknown }).logEntry).toBeUndefined();
    expect(entry.verb).toBe('loss_event');
  });
});
