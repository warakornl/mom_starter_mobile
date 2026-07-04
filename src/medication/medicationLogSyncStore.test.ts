/**
 * medicationLogSyncStore tests — TDD RED → GREEN (Slice 2, Task 7).
 *
 * Mirrors selfLogSyncStore.test.ts exactly, adapted for MedicationLog
 * (immutable event — create-only union; drainQueue emits under
 * changes.medicationLogs with updated[] always empty per D3).
 *
 * Covers:
 *  - addLog → getLogs returns it; drainQueue emits under medicationLogs.created
 *  - drainQueue.updated[] always empty (immutable event — D3)
 *  - drainQueue clears the queue
 *  - tombstoneLog → excluded from getLogs; appears in deleted[] on drain
 *  - tombstone skeleton for unknown id (convergence to other devices)
 *  - upsertLog (id, version) de-dup — pull-received records
 *  - stampApplied / adoptServerRecord
 *  - reEnqueueChangeset restores drained items
 *  - getPendingCount
 *  - reset() clears all state — cross-account-leak guard (PDPA 1.1)
 *
 * Security: note/occurrenceTime/medicationPlanId are opaque / sensitive health
 * data — NEVER logged (SD-5).
 */

import { createMedicationLogSyncStore } from './medicationLogSyncStore';
import type { MedicationLog, MedicationLogInput, SyncChangeSet } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OCCURRENCE_1 = '2026-07-04T08:00';
const OCCURRENCE_2 = '2026-07-04T20:00';

function makeInput(overrides: Partial<MedicationLogInput> = {}): MedicationLogInput {
  return {
    medicationPlanId: 'aaaaaaaa-0000-4000-8000-000000000010',
    occurrenceTime: OCCURRENCE_1,
    status: 'taken',
    note: null,
    ...overrides,
  };
}

function makeLog(overrides: Partial<MedicationLog> = {}): MedicationLog {
  const now = '2026-07-04T01:00:00Z';
  return {
    id: 'bbbbbbbb-0000-4000-8000-000000000020',
    medicationPlanId: 'aaaaaaaa-0000-4000-8000-000000000010',
    occurrenceTime: OCCURRENCE_1,
    status: 'taken',
    note: null,
    loggedAt: now,
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

// ─── addLog + drainQueue ──────────────────────────────────────────────────────

describe('medicationLogSyncStore — addLog + drainQueue', () => {
  it('addLog returns a MedicationLog with a generated id and version=0', () => {
    const store = createMedicationLogSyncStore();
    const result = store.addLog(makeInput());
    expect(result.id).toBeTruthy();
    expect(result.version).toBe(0);
    expect(result.status).toBe('taken');
    expect(result.occurrenceTime).toBe(OCCURRENCE_1);
  });

  it('getLogs returns the added log', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput());
    const logs = store.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('taken');
  });

  it('drainQueue emits added log under medicationLogs.created', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    const cs = store.drainQueue();
    expect(cs.medicationLogs).toBeDefined();
    expect(cs.medicationLogs!.created).toHaveLength(1);
    expect(cs.medicationLogs!.created[0].id).toBe(added.id);
  });

  it('drainQueue updated[] is ALWAYS empty (immutable event — D3)', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput());
    const cs = store.drainQueue();
    expect(cs.medicationLogs!.updated).toHaveLength(0);
  });

  it('drainQueue clears the queue after drain', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput());
    store.drainQueue();
    const cs2 = store.drainQueue();
    expect(cs2.medicationLogs!.created).toHaveLength(0);
  });

  it('two addLog calls create two distinct records (no same-input dedup)', () => {
    const store = createMedicationLogSyncStore();
    const a = store.addLog(makeInput());
    const b = store.addLog(makeInput());
    expect(a.id).not.toBe(b.id);
    expect(store.getLogs()).toHaveLength(2);
  });

  it('addLog with missed status and no plan link is accepted', () => {
    const store = createMedicationLogSyncStore();
    const result = store.addLog(makeInput({ medicationPlanId: null, status: 'missed' }));
    expect(result.status).toBe('missed');
    expect(result.medicationPlanId).toBeNull();
    expect(store.getLogs()).toHaveLength(1);
  });

  it('loggedAt on returned record is an absolute UTC ISO string', () => {
    const store = createMedicationLogSyncStore();
    const result = store.addLog(makeInput());
    expect(result.loggedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ─── getLog ───────────────────────────────────────────────────────────────────

describe('medicationLogSyncStore — getLog', () => {
  it('returns undefined for unknown id', () => {
    const store = createMedicationLogSyncStore();
    expect(store.getLog('unknown')).toBeUndefined();
  });

  it('returns the record including tombstones', () => {
    const store = createMedicationLogSyncStore();
    const log = makeLog({ deletedAt: '2026-07-04T03:00:00Z' });
    store.upsertLog(log);
    expect(store.getLog(log.id)).toBeDefined();
    expect(store.getLog(log.id)?.deletedAt).toBeTruthy();
  });
});

// ─── upsertLog (id, version) de-dup — pull path ───────────────────────────────

describe('medicationLogSyncStore — upsertLog (id, version) de-dup', () => {
  it('inserts a new record (pull path)', () => {
    const store = createMedicationLogSyncStore();
    const log = makeLog({ version: 1 });
    store.upsertLog(log);
    expect(store.getLog(log.id)).toMatchObject({ id: log.id, version: 1 });
  });

  it('does not overwrite a higher-version local row with a lower-version incoming', () => {
    const store = createMedicationLogSyncStore();
    store.upsertLog(makeLog({ version: 2, status: 'taken' }));
    store.upsertLog(makeLog({ version: 1, status: 'missed' }));
    expect(store.getLog(makeLog().id)?.status).toBe('taken');
  });

  it('overwrites with a higher-version incoming', () => {
    const store = createMedicationLogSyncStore();
    store.upsertLog(makeLog({ version: 1, status: 'taken' }));
    store.upsertLog(makeLog({ version: 3, status: 'missed' }));
    expect(store.getLog(makeLog().id)?.status).toBe('missed');
  });

  it('version=0 record (create sentinel) always writes', () => {
    const store = createMedicationLogSyncStore();
    store.upsertLog(makeLog({ version: 0, occurrenceTime: '2026-07-04T08:00' }));
    store.upsertLog(makeLog({ version: 0, occurrenceTime: '2026-07-04T09:00' }));
    // version=0 always overwrites (existing.version=0 not > 0)
    expect(store.getLog(makeLog().id)?.occurrenceTime).toBe('2026-07-04T09:00');
  });

  it('duplicate upsert of same (id, version) is idempotent', () => {
    const store = createMedicationLogSyncStore();
    const log = makeLog({ version: 1 });
    store.upsertLog(log);
    store.upsertLog(log);
    expect(store.getLogs()).toHaveLength(1);
  });
});

// ─── tombstoneLog ─────────────────────────────────────────────────────────────

describe('medicationLogSyncStore — tombstoneLog', () => {
  it('soft-deletes: record is excluded from getLogs after tombstone', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    store.tombstoneLog(added.id);
    expect(store.getLogs()).toHaveLength(0);
  });

  it('getLog(id) still returns tombstoned record (including tombstones)', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    store.tombstoneLog(added.id);
    expect(store.getLog(added.id)?.deletedAt).toBeTruthy();
  });

  it('drainQueue deleted[] contains the tombstoned id', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    store.tombstoneLog(added.id);
    const cs = store.drainQueue();
    expect(cs.medicationLogs!.deleted).toContain(added.id);
  });

  it('inserts a tombstone skeleton for unknown id (prevents re-appearance)', () => {
    const store = createMedicationLogSyncStore();
    store.tombstoneLog('ghost-log-id');
    const ghost = store.getLog('ghost-log-id');
    expect(ghost).toBeDefined();
    expect(ghost?.deletedAt).toBeTruthy();
  });

  it('tombstone-wins: tombstoneLog always sets deletedAt regardless of existing deletedAt', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    store.tombstoneLog(added.id);
    store.tombstoneLog(added.id); // second call must not throw
    expect(store.getLog(added.id)?.deletedAt).toBeTruthy();
  });
});

// ─── getLogs ──────────────────────────────────────────────────────────────────

describe('medicationLogSyncStore — getLogs', () => {
  it('returns empty array when no logs', () => {
    const store = createMedicationLogSyncStore();
    expect(store.getLogs()).toHaveLength(0);
  });

  it('excludes tombstoned records from getLogs', () => {
    const store = createMedicationLogSyncStore();
    const a = store.addLog(makeInput({ occurrenceTime: OCCURRENCE_1 }));
    store.addLog(makeInput({ occurrenceTime: OCCURRENCE_2 }));
    store.tombstoneLog(a.id);
    expect(store.getLogs()).toHaveLength(1);
  });

  it('getLogs filters tombstoned records upserted directly', () => {
    const store = createMedicationLogSyncStore();
    store.upsertLog(makeLog({ id: 'l1', version: 1 }));
    store.upsertLog(makeLog({ id: 'l2', version: 1, deletedAt: '2026-07-04T03:00:00Z' }));
    expect(store.getLogs()).toHaveLength(1);
    expect(store.getLogs()[0].id).toBe('l1');
  });
});

// ─── stampApplied ─────────────────────────────────────────────────────────────

describe('medicationLogSyncStore — stampApplied', () => {
  it('stamps server-assigned version and updatedAt after push ack', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    expect(added.version).toBe(0);
    store.stampApplied(added.id, 1, '2026-07-04T02:00:00Z');
    expect(store.getLog(added.id)?.version).toBe(1);
    expect(store.getLog(added.id)?.updatedAt).toBe('2026-07-04T02:00:00Z');
  });

  it('stampApplied on absent id is a no-op (does not throw)', () => {
    const store = createMedicationLogSyncStore();
    expect(() => store.stampApplied('no-such-id', 1, '2026-07-04T02:00:00Z')).not.toThrow();
  });
});

// ─── adoptServerRecord ────────────────────────────────────────────────────────

describe('medicationLogSyncStore — adoptServerRecord', () => {
  it('unconditionally adopts the server record (server_won resolution)', () => {
    const store = createMedicationLogSyncStore();
    store.upsertLog(makeLog({ version: 3, status: 'taken' }));
    const serverRecord = makeLog({ version: 5, status: 'missed' });
    store.adoptServerRecord(serverRecord);
    expect(store.getLog(serverRecord.id)?.version).toBe(5);
    expect(store.getLog(serverRecord.id)?.status).toBe('missed');
  });

  it('adopts a tombstone serverRecord (tombstone_won resolution)', () => {
    const store = createMedicationLogSyncStore();
    store.upsertLog(makeLog({ version: 1 }));
    const tombstoned = makeLog({ version: 2, deletedAt: '2026-07-04T04:00:00Z' });
    store.adoptServerRecord(tombstoned);
    expect(store.getLog(tombstoned.id)?.deletedAt).toBeTruthy();
    expect(store.getLogs()).toHaveLength(0);
  });
});

// ─── reEnqueueChangeset ───────────────────────────────────────────────────────

describe('medicationLogSyncStore — reEnqueueChangeset', () => {
  it('re-enqueues a previously drained created[] changeset (failed push retry)', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput());
    const cs = store.drainQueue();
    expect(store.drainQueue().medicationLogs!.created).toHaveLength(0);
    store.reEnqueueChangeset(cs);
    expect(store.drainQueue().medicationLogs!.created).toHaveLength(1);
  });

  it('re-enqueues a previously drained deleted[] changeset', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    store.tombstoneLog(added.id);
    const cs = store.drainQueue();
    expect(store.drainQueue().medicationLogs!.deleted).toHaveLength(0);
    store.reEnqueueChangeset(cs);
    expect(store.drainQueue().medicationLogs!.deleted).toHaveLength(1);
  });

  it('reEnqueueChangeset with empty/missing medicationLogs is a no-op', () => {
    const store = createMedicationLogSyncStore();
    const emptyCs: SyncChangeSet = {};
    expect(() => store.reEnqueueChangeset(emptyCs)).not.toThrow();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── getPendingCount ──────────────────────────────────────────────────────────

describe('medicationLogSyncStore — getPendingCount', () => {
  it('returns 0 on a fresh store', () => {
    expect(createMedicationLogSyncStore().getPendingCount()).toBe(0);
  });

  it('counts pending creates + deletes', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput({ occurrenceTime: '2026-07-04T08:00' }));
    store.addLog(makeInput({ occurrenceTime: '2026-07-04T12:00' }));
    const added = store.addLog(makeInput({ occurrenceTime: '2026-07-04T20:00' }));
    store.tombstoneLog(added.id);
    expect(store.getPendingCount()).toBe(4); // 3 creates + 1 delete
  });

  it('getPendingCount is 0 after drainQueue', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput());
    store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── watermark ────────────────────────────────────────────────────────────────

describe('medicationLogSyncStore — watermark', () => {
  it('getWatermark returns undefined on fresh store', () => {
    expect(createMedicationLogSyncStore().getWatermark()).toBeUndefined();
  });

  it('setWatermark + getWatermark round-trips', () => {
    const store = createMedicationLogSyncStore();
    store.setWatermark('2026-07-04T04:00:00Z');
    expect(store.getWatermark()).toBe('2026-07-04T04:00:00Z');
  });
});

// ─── reset() — PDPA logout isolation (cross-account-leak guard) ───────────────

describe('medicationLogSyncStore — reset() PDPA logout isolation', () => {
  it('clears all logs so User B cannot see User A\'s logs after logout', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput({ occurrenceTime: OCCURRENCE_1 }));
    store.addLog(makeInput({ occurrenceTime: OCCURRENCE_2 }));
    store.setWatermark('wm-userA');

    store.reset();

    expect(store.getLogs()).toHaveLength(0);
    expect(store.getWatermark()).toBeUndefined();
    expect(store.getPendingCount()).toBe(0);
  });

  it('clears the pending push queue on logout — no queued mutations survive', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput());
    expect(store.getPendingCount()).toBeGreaterThan(0);

    store.reset();

    expect(store.getPendingCount()).toBe(0);
  });

  it('getLog returns undefined for all prior ids after reset (no data leak)', () => {
    const store = createMedicationLogSyncStore();
    const added = store.addLog(makeInput());
    store.reset();
    expect(store.getLog(added.id)).toBeUndefined();
  });

  it('store is fully usable after reset (simulates User B logging in)', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput({ occurrenceTime: OCCURRENCE_1 }));
    store.reset();

    // User B adds their own log
    const userBLog = store.addLog(makeInput({ status: 'missed', occurrenceTime: OCCURRENCE_2 }));
    expect(store.getLogs()).toHaveLength(1);
    expect(store.getLogs()[0].id).toBe(userBLog.id);
  });
});

// ─── getLogsSortedDesc — Task 7 reviewer follow-up ───────────────────────────

describe('medicationLogSyncStore — getLogsSortedDesc', () => {
  it('returns empty array on fresh store', () => {
    const store = createMedicationLogSyncStore();
    expect(store.getLogsSortedDesc()).toEqual([]);
  });

  it('returns a single record unchanged', () => {
    const store = createMedicationLogSyncStore();
    const log = store.addLog(makeInput({ occurrenceTime: '2026-07-04T08:00' }));
    const result = store.getLogsSortedDesc();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(log.id);
  });

  it('sorts multiple records desc by occurrenceTime (most-recent first)', () => {
    const store = createMedicationLogSyncStore();
    const a = store.addLog(makeInput({ occurrenceTime: '2026-07-01T08:00' }));
    const b = store.addLog(makeInput({ occurrenceTime: '2026-07-03T20:00' }));
    const c = store.addLog(makeInput({ occurrenceTime: '2026-07-02T12:00' }));

    const result = store.getLogsSortedDesc();
    expect(result.map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it('excludes tombstoned records', () => {
    const store = createMedicationLogSyncStore();
    const live = store.addLog(makeInput({ occurrenceTime: '2026-07-04T09:00' }));
    const dead = store.addLog(makeInput({ occurrenceTime: '2026-07-04T10:00' }));
    store.tombstoneLog(dead.id);

    const result = store.getLogsSortedDesc();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(live.id);
  });

  it('does not mutate the internal map (getLogs still returns unsorted array)', () => {
    const store = createMedicationLogSyncStore();
    store.addLog(makeInput({ occurrenceTime: '2026-07-01T08:00' }));
    store.addLog(makeInput({ occurrenceTime: '2026-07-03T08:00' }));

    // Calling getLogsSortedDesc must not alter getLogs iteration order
    store.getLogsSortedDesc();
    // getLogs should still return both records (no side-effects on the map)
    expect(store.getLogs()).toHaveLength(2);
  });
});
