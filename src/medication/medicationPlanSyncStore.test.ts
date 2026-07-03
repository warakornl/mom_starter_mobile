/**
 * medicationPlanSyncStore tests — TDD RED → GREEN (Slice 2, Task 7).
 *
 * Mirrors expensesSyncStore.test.ts exactly, adapted for MedicationPlan
 * (mutable LWW — create / update / tombstone; same (id, version) de-dup
 * and drainQueue shape as expenses, under changes.medicationPlans).
 *
 * Covers:
 *  - addPlan → getPlans returns it; drainQueue emits under medicationPlans.created
 *  - updatePlan → getPlans reflects change; drainQueue emits under medicationPlans.updated
 *  - tombstonePlan → excluded from getPlans; appears in deleted[] on drain
 *  - tombstone skeleton for unknown id (convergence to other devices)
 *  - upsertPlan (id, version) de-dup — pull-received records (LWW)
 *  - stampApplied / adoptServerRecord
 *  - drainQueue shape: created / updated / deleted all live (LWW)
 *  - reEnqueueChangeset restores drained items
 *  - getPendingCount
 *  - reset() clears all state — cross-account-leak guard (PDPA 1.1)
 *
 * Security: name/dose are opaque base64 — NEVER logged (SD-2/SD-5).
 */

import { createMedicationPlanSyncStore } from './medicationPlanSyncStore';
import type { MedicationPlan, MedicationPlanInput } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<MedicationPlan> = {}): MedicationPlan {
  const now = '2026-07-04T01:00:00Z';
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000010',
    name: 'Rm9saWMgQWNpZA==', // base64 opaque — never inspected
    dose: 'NTAwbWc=',
    scheduleRule: { freq: 'daily', startAt: '2026-07-04T08:00', timesOfDay: ['08:00'] },
    active: true,
    sourceSuggestionStateId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<MedicationPlanInput> = {}): MedicationPlanInput {
  return {
    name: 'Rm9saWMgQWNpZA==',
    dose: 'NTAwbWc=',
    scheduleRule: { freq: 'daily', startAt: '2026-07-04T08:00', timesOfDay: ['08:00'] },
    active: true,
    ...overrides,
  };
}

// ─── addPlan ──────────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — addPlan', () => {
  it('returns a MedicationPlan with a generated id and version=0', () => {
    const store = createMedicationPlanSyncStore();
    const result = store.addPlan(makeInput());
    expect(result.id).toBeTruthy();
    expect(result.version).toBe(0);
    expect(result.active).toBe(true);
  });

  it('getPlans returns the added plan', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    expect(store.getPlans()).toHaveLength(1);
  });

  it('drainQueue emits added plan under medicationPlans.created', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    const cs = store.drainQueue();
    expect(cs.medicationPlans).toBeDefined();
    expect(cs.medicationPlans!.created).toHaveLength(1);
    expect(cs.medicationPlans!.created[0].id).toBe(added.id);
  });

  it('drainQueue updated[] is empty when only a create is pending', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    const cs = store.drainQueue();
    expect(cs.medicationPlans!.updated).toHaveLength(0);
  });

  it('drainQueue deleted[] is empty when only a create is pending', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    const cs = store.drainQueue();
    expect(cs.medicationPlans!.deleted).toHaveLength(0);
  });

  it('drainQueue clears the queue after drain', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    store.drainQueue();
    const cs2 = store.drainQueue();
    expect(cs2.medicationPlans!.created).toHaveLength(0);
  });

  it('addPlan with null scheduleRule (PRN/ad-hoc) is accepted', () => {
    const store = createMedicationPlanSyncStore();
    const result = store.addPlan(makeInput({ scheduleRule: null }));
    expect(result.scheduleRule).toBeNull();
    expect(store.getPlans()).toHaveLength(1);
  });
});

// ─── updatePlan ───────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — updatePlan', () => {
  it('updatePlan modifies the local record and enqueues as updated', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    // stamp a server version so it becomes a mutable record
    store.stampApplied(added.id, 1, '2026-07-04T02:00:00Z');

    store.updatePlan(added.id, { active: false });

    const plan = store.getPlan(added.id);
    expect(plan?.active).toBe(false);
  });

  it('updatePlan drains under medicationPlans.updated', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.stampApplied(added.id, 1, '2026-07-04T02:00:00Z');
    store.drainQueue(); // drain the create

    store.updatePlan(added.id, { active: false });
    const cs = store.drainQueue();
    expect(cs.medicationPlans!.updated).toHaveLength(1);
    expect(cs.medicationPlans!.updated[0].active).toBe(false);
  });

  it('updatePlan on unknown id is a no-op (does not throw)', () => {
    const store = createMedicationPlanSyncStore();
    expect(() => store.updatePlan('no-such-id', { active: false })).not.toThrow();
  });
});

// ─── getPlan ──────────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — getPlan', () => {
  it('returns undefined for unknown id', () => {
    const store = createMedicationPlanSyncStore();
    expect(store.getPlan('unknown')).toBeUndefined();
  });

  it('returns the record including tombstones', () => {
    const store = createMedicationPlanSyncStore();
    const plan = makePlan({ deletedAt: '2026-07-04T03:00:00Z' });
    store.upsertPlan(plan);
    expect(store.getPlan(plan.id)).toBeDefined();
    expect(store.getPlan(plan.id)?.deletedAt).toBeTruthy();
  });
});

// ─── upsertPlan (LWW de-dup by version — pull path) ──────────────────────────

describe('medicationPlanSyncStore — upsertPlan (id, version) de-dup', () => {
  it('inserts a new record (pull path)', () => {
    const store = createMedicationPlanSyncStore();
    const plan = makePlan({ version: 1 });
    store.upsertPlan(plan);
    expect(store.getPlan(plan.id)).toMatchObject({ id: plan.id, version: 1 });
  });

  it('does not overwrite a higher-version local row with a lower-version incoming', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ version: 5, active: true }));
    store.upsertPlan(makePlan({ version: 3, active: false }));
    expect(store.getPlan(makePlan().id)?.active).toBe(true);
  });

  it('overwrites with a higher-version incoming', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ version: 3, active: true }));
    store.upsertPlan(makePlan({ version: 5, active: false }));
    expect(store.getPlan(makePlan().id)?.active).toBe(false);
  });

  it('version=0 record (create sentinel) always writes', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ version: 0, name: 'Zmlyc3Q=' }));
    store.upsertPlan(makePlan({ version: 0, name: 'c2Vjb25k=' }));
    // version=0 always overwrites (existing.version=0 is not > 0)
    expect(store.getPlan(makePlan().id)?.name).toBe('c2Vjb25k=');
  });

  it('duplicate upsert of same (id, version) is idempotent', () => {
    const store = createMedicationPlanSyncStore();
    const plan = makePlan({ version: 1 });
    store.upsertPlan(plan);
    store.upsertPlan(plan);
    expect(store.getPlans()).toHaveLength(1);
  });
});

// ─── tombstonePlan ────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — tombstonePlan', () => {
  it('soft-deletes: record is excluded from getPlans after tombstone', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.tombstonePlan(added.id);
    expect(store.getPlans()).toHaveLength(0);
  });

  it('getPlan(id) still returns tombstoned record (including tombstones)', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.tombstonePlan(added.id);
    expect(store.getPlan(added.id)?.deletedAt).toBeTruthy();
  });

  it('drainQueue deleted[] contains the tombstoned id', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.tombstonePlan(added.id);
    const cs = store.drainQueue();
    expect(cs.medicationPlans!.deleted).toContain(added.id);
  });

  it('inserts a tombstone skeleton for unknown id (prevents re-appearance)', () => {
    const store = createMedicationPlanSyncStore();
    store.tombstonePlan('ghost-plan-id');
    const ghost = store.getPlan('ghost-plan-id');
    expect(ghost).toBeDefined();
    expect(ghost?.deletedAt).toBeTruthy();
  });

  it('tombstone-wins: tombstonePlan always sets deletedAt regardless of existing deletedAt', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.tombstonePlan(added.id);
    store.tombstonePlan(added.id); // second call must not throw
    expect(store.getPlan(added.id)?.deletedAt).toBeTruthy();
  });
});

// ─── getPlans ─────────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — getPlans', () => {
  it('returns empty array on fresh store', () => {
    const store = createMedicationPlanSyncStore();
    expect(store.getPlans()).toEqual([]);
  });

  it('returns only live (non-tombstoned) records', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ id: 'p1', version: 1 }));
    store.upsertPlan(makePlan({ id: 'p2', version: 1, deletedAt: '2026-07-04T03:00:00Z' }));
    expect(store.getPlans()).toHaveLength(1);
    expect(store.getPlans()[0].id).toBe('p1');
  });
});

// ─── stampApplied ─────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — stampApplied', () => {
  it('stamps server-assigned version and updatedAt after push ack', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    expect(added.version).toBe(0);
    store.stampApplied(added.id, 1, '2026-07-04T02:00:00Z');
    expect(store.getPlan(added.id)?.version).toBe(1);
    expect(store.getPlan(added.id)?.updatedAt).toBe('2026-07-04T02:00:00Z');
  });

  it('stampApplied on absent id is a no-op (does not throw)', () => {
    const store = createMedicationPlanSyncStore();
    expect(() => store.stampApplied('no-such-id', 1, '2026-07-04T02:00:00Z')).not.toThrow();
  });
});

// ─── adoptServerRecord ────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — adoptServerRecord', () => {
  it('unconditionally adopts the server record (server_won resolution)', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ version: 3, active: true }));
    const serverRecord = makePlan({ version: 5, active: false });
    store.adoptServerRecord(serverRecord);
    expect(store.getPlan(serverRecord.id)?.version).toBe(5);
    expect(store.getPlan(serverRecord.id)?.active).toBe(false);
  });

  it('adopts a tombstone serverRecord (tombstone_won resolution)', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ version: 1 }));
    const tombstoned = makePlan({ version: 2, deletedAt: '2026-07-04T04:00:00Z' });
    store.adoptServerRecord(tombstoned);
    expect(store.getPlan(tombstoned.id)?.deletedAt).toBeTruthy();
    expect(store.getPlans()).toHaveLength(0);
  });
});

// ─── drainQueue — LWW shape ───────────────────────────────────────────────────

describe('medicationPlanSyncStore — drainQueue LWW shape', () => {
  it('returns SyncChangeSet with medicationPlans key containing all three buckets', () => {
    const store = createMedicationPlanSyncStore();
    const cs = store.drainQueue();
    expect(cs.medicationPlans).toBeDefined();
    expect(cs.medicationPlans!.created).toBeInstanceOf(Array);
    expect(cs.medicationPlans!.updated).toBeInstanceOf(Array);
    expect(cs.medicationPlans!.deleted).toBeInstanceOf(Array);
  });

  it('all three buckets are populated when create+update+delete are pending', () => {
    const store = createMedicationPlanSyncStore();
    // create
    const added = store.addPlan(makeInput());
    store.stampApplied(added.id, 1, '2026-07-04T01:00:00Z');

    // pull-insert a second plan then update it
    store.upsertPlan(makePlan({ id: 'p2', version: 1 }));
    store.updatePlan('p2', { active: false });

    // tombstone a third
    store.upsertPlan(makePlan({ id: 'p3', version: 1 }));
    store.tombstonePlan('p3');

    const cs = store.drainQueue();
    expect(cs.medicationPlans!.created).toHaveLength(1);
    expect(cs.medicationPlans!.updated).toHaveLength(1);
    expect(cs.medicationPlans!.deleted).toContain('p3');
  });

  it('clears pending queue after drain', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── reEnqueueChangeset ───────────────────────────────────────────────────────

describe('medicationPlanSyncStore — reEnqueueChangeset', () => {
  it('restores drained created[] items back into pending', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    const cs = store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
    store.reEnqueueChangeset(cs);
    expect(store.getPendingCount()).toBe(1);
  });

  it('restores drained updated[] items', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.stampApplied(added.id, 1, '2026-07-04T01:00:00Z');
    store.drainQueue(); // drain create
    store.updatePlan(added.id, { active: false });
    const cs = store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
    store.reEnqueueChangeset(cs);
    expect(store.getPendingCount()).toBe(1);
  });

  it('restores drained deleted[] items', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.drainQueue(); // drain the create first so only the delete is in next changeset
    store.tombstonePlan(added.id);
    const cs = store.drainQueue(); // cs has only the delete
    expect(store.getPendingCount()).toBe(0);
    store.reEnqueueChangeset(cs);
    expect(store.getPendingCount()).toBe(1); // only the delete was re-enqueued
  });

  it('reEnqueueChangeset with empty/missing medicationPlans is a no-op', () => {
    const store = createMedicationPlanSyncStore();
    expect(() => store.reEnqueueChangeset({})).not.toThrow();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── getPendingCount ──────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — getPendingCount', () => {
  it('returns 0 on a fresh store', () => {
    expect(createMedicationPlanSyncStore().getPendingCount()).toBe(0);
  });

  it('counts pending creates + updates + deletes', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput()); // +1 create
    store.stampApplied(added.id, 1, '2026-07-04T01:00:00Z');
    store.drainQueue();
    store.updatePlan(added.id, { active: false }); // +1 update
    store.upsertPlan(makePlan({ id: 'p2', version: 1 }));
    store.tombstonePlan('p2'); // +1 delete
    expect(store.getPendingCount()).toBe(2);
  });

  it('getPendingCount is 0 after drainQueue', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── watermark ────────────────────────────────────────────────────────────────

describe('medicationPlanSyncStore — watermark', () => {
  it('returns undefined before first pull', () => {
    expect(createMedicationPlanSyncStore().getWatermark()).toBeUndefined();
  });

  it('setWatermark + getWatermark round-trips', () => {
    const store = createMedicationPlanSyncStore();
    store.setWatermark('2026-07-04T04:00:00Z');
    expect(store.getWatermark()).toBe('2026-07-04T04:00:00Z');
  });
});

// ─── reset() — PDPA logout isolation (cross-account-leak guard) ───────────────

describe('medicationPlanSyncStore — reset() PDPA logout isolation', () => {
  it('clears all plans so User B cannot see User A\'s plans after logout', () => {
    const store = createMedicationPlanSyncStore();
    store.upsertPlan(makePlan({ id: 'p1', version: 1 }));
    store.upsertPlan(makePlan({ id: 'p2', version: 1 }));
    store.setWatermark('wm-userA');

    store.reset();

    expect(store.getPlans()).toHaveLength(0);
    expect(store.getWatermark()).toBeUndefined();
    expect(store.getPendingCount()).toBe(0);
  });

  it('clears the pending push queue on logout — no queued mutations survive', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    expect(store.getPendingCount()).toBeGreaterThan(0);

    store.reset();

    expect(store.getPendingCount()).toBe(0);
  });

  it('getPlan returns undefined for all prior ids after reset (no data leak)', () => {
    const store = createMedicationPlanSyncStore();
    const added = store.addPlan(makeInput());
    store.reset();
    expect(store.getPlan(added.id)).toBeUndefined();
  });

  it('store is fully usable after reset (simulates User B logging in)', () => {
    const store = createMedicationPlanSyncStore();
    store.addPlan(makeInput());
    store.reset();

    // User B adds their own plan
    const userBPlan = store.addPlan(makeInput({ name: 'dXNlckI=' }));
    expect(store.getPlans()).toHaveLength(1);
    expect(store.getPlans()[0].id).toBe(userBPlan.id);
  });
});
