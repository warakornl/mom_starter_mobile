/**
 * selfLogSyncStore tests — TDD (RED → GREEN).
 *
 * Mirrors kickCountSyncStore.test.ts exactly, adapted for SelfLog (immutable event).
 *
 * Covers:
 *  - addSelfLog → getSelfLogs returns it; drainQueue emits under selfLogs.created
 *  - drainQueue clears the queue
 *  - upsertSelfLog (id, version) de-dup — pull-received records
 *  - tombstoneSelfLog → excluded from getSelfLogs; appears in deleted[] on drain
 *  - tombstone skeleton for unknown id (convergence to other devices)
 *  - stampApplied / adoptServerRecord
 *  - getSelfLogs filters tombstoned rows; sorts by loggedAt descending
 *  - reEnqueueChangeset
 *  - getPendingCount
 *  - watermark get/set
 *  - reset() clears all state — cross-account-leak guard (PDPA 1.1)
 *
 * Security: never log value/note fields (MOTHER-health SD-5).
 * Call reset() on logout — tested here (logout simulation).
 */

import { createSelfLogSyncStore } from './selfLogSyncStore';
import type { SelfLog, SelfLogInput, SyncChangeSet } from '../sync/syncTypes';

const LOGGED_AT_1 = '2026-07-03T13:00';
const LOGGED_AT_2 = '2026-07-03T09:00';

/** Minimal SelfLogInput for weight (most common in tests). */
function makeInput(overrides: Partial<SelfLogInput> = {}): SelfLogInput {
  return {
    metricType: 'weight',
    valueNumeric: 'dGVzdA==', // base64 "test"
    unit: 'kg',
    loggedAt: LOGGED_AT_1,
    ...overrides,
  };
}

/** Build a SelfLog with a fixed id for pull-path (upsert) tests. */
function makeSelfLog(overrides: Partial<SelfLog> = {}): SelfLog {
  const now = new Date().toISOString();
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    metricType: 'weight',
    valueNumeric: 'dGVzdA==',
    unit: 'kg',
    loggedAt: LOGGED_AT_1,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

// ─── addSelfLog + drainQueue ────────────────────────────────────────────────────

describe('selfLogSyncStore — addSelfLog + drainQueue', () => {
  it('addSelfLog returns a SelfLog with a generated id and version=0', () => {
    const store = createSelfLogSyncStore();
    const result = store.addSelfLog(makeInput());
    expect(result.id).toBeTruthy();
    expect(result.version).toBe(0);
    expect(result.metricType).toBe('weight');
    expect(result.loggedAt).toBe(LOGGED_AT_1);
  });

  it('getSelfLogs returns the added log', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput());
    const logs = store.getSelfLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].metricType).toBe('weight');
  });

  it('drainQueue emits added log under selfLogs.created', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    const changeSet = store.drainQueue();
    expect(changeSet.selfLogs).toBeDefined();
    expect(changeSet.selfLogs!.created).toHaveLength(1);
    expect(changeSet.selfLogs!.created[0].id).toBe(added.id);
  });

  it('drainQueue updated[] is always empty (immutable event — D2)', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput());
    const changeSet = store.drainQueue();
    expect(changeSet.selfLogs!.updated).toHaveLength(0);
  });

  it('drainQueue clears the queue after drain', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput());
    store.drainQueue();
    const changeSet2 = store.drainQueue();
    expect(changeSet2.selfLogs!.created).toHaveLength(0);
  });

  it('two addSelfLog calls create two distinct records (no same-input dedup — E9)', () => {
    const store = createSelfLogSyncStore();
    const a = store.addSelfLog(makeInput());
    const b = store.addSelfLog(makeInput());
    expect(a.id).not.toBe(b.id);
    expect(store.getSelfLogs()).toHaveLength(2);
  });
});

// ─── upsertSelfLog — (id, version) de-dup (pull-received records) ──────────────

describe('selfLogSyncStore — upsertSelfLog (id, version) de-dup', () => {
  it('inserts a new record (pull path)', () => {
    const store = createSelfLogSyncStore();
    const record = makeSelfLog({ version: 1 });
    store.upsertSelfLog(record);
    expect(store.getSelfLog(record.id)).toMatchObject({ id: record.id, version: 1 });
  });

  it('does not overwrite a higher-version local row with a lower-version incoming', () => {
    const store = createSelfLogSyncStore();
    store.upsertSelfLog(makeSelfLog({ version: 2 }));
    store.upsertSelfLog(makeSelfLog({ version: 1 }));
    expect(store.getSelfLog(makeSelfLog().id)?.version).toBe(2);
  });

  it('overwrites with a higher-version incoming', () => {
    const store = createSelfLogSyncStore();
    store.upsertSelfLog(makeSelfLog({ version: 1 }));
    store.upsertSelfLog(makeSelfLog({ version: 3 }));
    expect(store.getSelfLog(makeSelfLog().id)?.version).toBe(3);
  });

  it('duplicate upsert of same (id, version) is idempotent — getSelfLogs returns one entry', () => {
    const store = createSelfLogSyncStore();
    const record = makeSelfLog({ version: 1 });
    store.upsertSelfLog(record);
    store.upsertSelfLog(record); // duplicate — must be a no-op at the map level
    expect(store.getSelfLogs()).toHaveLength(1);
  });

  it('version=0 record (create sentinel) always writes regardless of existing', () => {
    const store = createSelfLogSyncStore();
    store.upsertSelfLog(makeSelfLog({ version: 0, valueNumeric: 'Zmlyc3Q=' }));
    store.upsertSelfLog(makeSelfLog({ version: 0, valueNumeric: 'c2Vjb25k=' }));
    // version=0 always overwrites (create sentinel — existing.version=0 not > 0)
    expect(store.getSelfLog(makeSelfLog().id)?.valueNumeric).toBe('c2Vjb25k=');
  });
});

// ─── tombstoneSelfLog ──────────────────────────────────────────────────────────

describe('selfLogSyncStore — tombstoneSelfLog', () => {
  it('soft-deletes: record is excluded from getSelfLogs after tombstone', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    store.tombstoneSelfLog(added.id);
    expect(store.getSelfLogs()).toHaveLength(0);
  });

  it('getSelfLog(id) still returns tombstoned record (including tombstones)', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    store.tombstoneSelfLog(added.id);
    expect(store.getSelfLog(added.id)?.deletedAt).toBeTruthy();
  });

  it('drainQueue deleted[] contains the tombstoned id', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    store.tombstoneSelfLog(added.id);
    const changeSet = store.drainQueue();
    expect(changeSet.selfLogs!.deleted).toContain(added.id);
  });

  it('inserts a tombstone skeleton for unknown id (convergence to other devices)', () => {
    const store = createSelfLogSyncStore();
    store.tombstoneSelfLog('unknown-id-xyz');
    const skeleton = store.getSelfLog('unknown-id-xyz');
    expect(skeleton?.deletedAt).toBeTruthy();
    expect(skeleton?.id).toBe('unknown-id-xyz');
  });

  it('tombstone-wins: tombstoneSelfLog always sets deletedAt regardless of existing deletedAt', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    store.tombstoneSelfLog(added.id);
    store.tombstoneSelfLog(added.id); // second tombstone must not throw
    expect(store.getSelfLog(added.id)?.deletedAt).toBeTruthy();
  });
});

// ─── getSelfLogs — read + sort ─────────────────────────────────────────────────

describe('selfLogSyncStore — getSelfLogs', () => {
  it('returns empty array when no logs', () => {
    const store = createSelfLogSyncStore();
    expect(store.getSelfLogs()).toHaveLength(0);
  });

  it('excludes tombstoned records from getSelfLogs', () => {
    const store = createSelfLogSyncStore();
    const a = store.addSelfLog(makeInput({ loggedAt: LOGGED_AT_1 }));
    store.addSelfLog(makeInput({ loggedAt: LOGGED_AT_2 }));
    store.tombstoneSelfLog(a.id);
    expect(store.getSelfLogs()).toHaveLength(1);
  });

  it('sorts live logs by loggedAt descending', () => {
    const store = createSelfLogSyncStore();
    store.upsertSelfLog(makeSelfLog({ id: 'id-1', loggedAt: LOGGED_AT_2, version: 1 }));
    store.upsertSelfLog(makeSelfLog({ id: 'id-2', loggedAt: LOGGED_AT_1, version: 1 }));
    const logs = store.getSelfLogs();
    expect(logs[0].loggedAt).toBe(LOGGED_AT_1); // later time first
    expect(logs[1].loggedAt).toBe(LOGGED_AT_2);
  });

  it('getSelfLog returns undefined for absent id', () => {
    const store = createSelfLogSyncStore();
    expect(store.getSelfLog('absent-id')).toBeUndefined();
  });
});

// ─── stampApplied ──────────────────────────────────────────────────────────────

describe('selfLogSyncStore — stampApplied', () => {
  it('stamps server-assigned version and updatedAt on local row after push ack', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    expect(added.version).toBe(0);
    store.stampApplied(added.id, 1, '2026-07-03T06:00:00.000Z');
    expect(store.getSelfLog(added.id)?.version).toBe(1);
    expect(store.getSelfLog(added.id)?.updatedAt).toBe('2026-07-03T06:00:00.000Z');
  });

  it('stampApplied on absent id is a no-op (does not throw)', () => {
    const store = createSelfLogSyncStore();
    expect(() => store.stampApplied('no-such-id', 1, '2026-07-03T06:00:00.000Z')).not.toThrow();
  });
});

// ─── adoptServerRecord ─────────────────────────────────────────────────────────

describe('selfLogSyncStore — adoptServerRecord', () => {
  it('unconditionally adopts the server record (server_won resolution)', () => {
    const store = createSelfLogSyncStore();
    store.upsertSelfLog(makeSelfLog({ version: 3 }));
    const serverRecord = makeSelfLog({ version: 5, valueNumeric: 'c2VydmVy' });
    store.adoptServerRecord(serverRecord);
    expect(store.getSelfLog(serverRecord.id)?.version).toBe(5);
    expect(store.getSelfLog(serverRecord.id)?.valueNumeric).toBe('c2VydmVy');
  });

  it('adopts a tombstone serverRecord (tombstone_won resolution)', () => {
    const store = createSelfLogSyncStore();
    store.upsertSelfLog(makeSelfLog({ version: 1 }));
    const tombstoned = makeSelfLog({ version: 2, deletedAt: '2026-07-03T07:00:00.000Z' });
    store.adoptServerRecord(tombstoned);
    expect(store.getSelfLog(tombstoned.id)?.deletedAt).toBeTruthy();
    expect(store.getSelfLogs()).toHaveLength(0); // excluded from live reads
  });
});

// ─── reEnqueueChangeset ────────────────────────────────────────────────────────

describe('selfLogSyncStore — reEnqueueChangeset', () => {
  it('re-enqueues a previously drained created[] changeset (failed push retry)', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput());
    const cs = store.drainQueue();
    expect(store.drainQueue().selfLogs!.created).toHaveLength(0); // cleared
    store.reEnqueueChangeset(cs);
    expect(store.drainQueue().selfLogs!.created).toHaveLength(1);
  });

  it('re-enqueues a previously drained deleted[] changeset', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    store.tombstoneSelfLog(added.id);
    const cs = store.drainQueue();
    expect(store.drainQueue().selfLogs!.deleted).toHaveLength(0);
    store.reEnqueueChangeset(cs);
    expect(store.drainQueue().selfLogs!.deleted).toHaveLength(1);
  });

  it('reEnqueueChangeset with empty/missing selfLogs is a no-op', () => {
    const store = createSelfLogSyncStore();
    const emptyCs: SyncChangeSet = {};
    expect(() => store.reEnqueueChangeset(emptyCs)).not.toThrow();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── getPendingCount ───────────────────────────────────────────────────────────

describe('selfLogSyncStore — getPendingCount', () => {
  it('returns 0 on a fresh store', () => {
    expect(createSelfLogSyncStore().getPendingCount()).toBe(0);
  });

  it('counts pending creates + deletes', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput({ loggedAt: '2026-07-03T10:00' }));
    store.addSelfLog(makeInput({ loggedAt: '2026-07-03T11:00' }));
    const added = store.addSelfLog(makeInput({ loggedAt: '2026-07-03T12:00' }));
    store.tombstoneSelfLog(added.id);
    expect(store.getPendingCount()).toBe(4); // 3 creates + 1 delete
  });

  it('getPendingCount is 0 after drainQueue', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput());
    store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── watermark ─────────────────────────────────────────────────────────────────

describe('selfLogSyncStore — watermark', () => {
  it('getWatermark returns undefined on fresh store', () => {
    expect(createSelfLogSyncStore().getWatermark()).toBeUndefined();
  });

  it('setWatermark + getWatermark round-trips', () => {
    const store = createSelfLogSyncStore();
    store.setWatermark('2026-07-03T06:00:00.000Z');
    expect(store.getWatermark()).toBe('2026-07-03T06:00:00.000Z');
  });
});

// ─── reset() — PDPA logout isolation (cross-account-leak guard) ────────────────

describe('selfLogSyncStore — reset() PDPA logout isolation', () => {
  it('clears all logs so User B cannot see User A\'s self-logs after logout', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput({ loggedAt: LOGGED_AT_1 }));
    store.addSelfLog(makeInput({ loggedAt: LOGGED_AT_2 }));
    store.setWatermark('wm-userA');

    store.reset();

    expect(store.getSelfLogs()).toHaveLength(0);
    expect(store.getWatermark()).toBeUndefined();
    expect(store.getPendingCount()).toBe(0);
  });

  it('clears the pending push queue on logout — no queued mutations survive', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput());
    expect(store.getPendingCount()).toBeGreaterThan(0);

    store.reset();

    expect(store.getPendingCount()).toBe(0);
  });

  it('getSelfLog returns undefined for all prior ids after reset (no data leak)', () => {
    const store = createSelfLogSyncStore();
    const added = store.addSelfLog(makeInput());
    store.reset();
    expect(store.getSelfLog(added.id)).toBeUndefined();
  });

  it('store is fully usable after reset (simulates User B logging in)', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(makeInput({ loggedAt: LOGGED_AT_1 }));
    store.reset();

    // User B adds their own log
    const userBLog = store.addSelfLog(makeInput({ metricType: 'symptom', valueText: 'dGVzdA==', unit: null, loggedAt: LOGGED_AT_2 }));
    expect(store.getSelfLogs()).toHaveLength(1);
    expect(store.getSelfLogs()[0].id).toBe(userBLog.id);
  });
});
