/**
 * expensesSyncStore — TDD test suite (failing tests written first).
 *
 * Mirrors the supplySyncStore/syncStore pattern:
 *   - createExpensesSyncStore() factory creates a fresh in-memory store
 *   - Upsert de-duplication by (id, version)
 *   - Tombstone handling (soft-delete from pull + from local delete)
 *   - Mutation queue: enqueueCreate / enqueueUpdate / enqueueDelete
 *   - drainQueue() → SyncChangeSet with changes.expenses
 *   - reEnqueueChangeset() restores drained items
 *   - stampApplied() stamps server version + updatedAt
 *   - adoptServerRecord() replaces local record
 *   - reset() clears everything (PDPA: no cross-account leak)
 *   - getWatermark() / setWatermark()
 */

import { createExpensesSyncStore } from './expensesSyncStore';
import type { ExpenseRecord } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExpense(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: 'exp-001',
    amount: 59000,
    category: 'baby-supplies',
    incurredOn: '2026-06-28',
    version: 1,
    clientId: 'client-1',
    createdAt: '2026-06-28T10:00:00Z',
    updatedAt: '2026-06-28T10:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

// ─── getExpenses ──────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — getExpenses', () => {
  it('returns empty array on fresh store', () => {
    const store = createExpensesSyncStore();
    expect(store.getExpenses()).toEqual([]);
  });

  it('returns upserted live records', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense());
    expect(store.getExpenses()).toHaveLength(1);
  });

  it('filters out tombstoned records', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ deletedAt: '2026-06-29T00:00:00Z' }));
    expect(store.getExpenses()).toHaveLength(0);
  });
});

// ─── getExpense ───────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — getExpense', () => {
  it('returns undefined for unknown id', () => {
    const store = createExpensesSyncStore();
    expect(store.getExpense('unknown')).toBeUndefined();
  });

  it('returns the record including tombstones', () => {
    const store = createExpensesSyncStore();
    const exp = makeExpense({ deletedAt: '2026-06-29T00:00:00Z' });
    store.upsertExpense(exp);
    expect(store.getExpense('exp-001')).toBeDefined();
  });
});

// ─── upsertExpense (de-dup by version) ───────────────────────────────────────

describe('createExpensesSyncStore — upsertExpense de-dup', () => {
  it('does not overwrite a newer version with an older one', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ version: 5, amount: 59000 }));
    store.upsertExpense(makeExpense({ version: 3, amount: 99999 }));
    const items = store.getExpenses();
    expect(items[0].amount).toBe(59000);
  });

  it('overwrites with a newer version', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ version: 3, amount: 59000 }));
    store.upsertExpense(makeExpense({ version: 5, amount: 99999 }));
    const items = store.getExpenses();
    expect(items[0].amount).toBe(99999);
  });

  it('always writes a version=0 create-sentinel record', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ version: 0, amount: 59000 }));
    expect(store.getExpenses()).toHaveLength(1);
  });
});

// ─── tombstoneExpense ─────────────────────────────────────────────────────────

describe('createExpensesSyncStore — tombstoneExpense', () => {
  it('soft-deletes an existing record', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense());
    store.tombstoneExpense('exp-001');
    expect(store.getExpenses()).toHaveLength(0);
    expect(store.getExpense('exp-001')?.deletedAt).toBeTruthy();
  });

  it('inserts a skeleton tombstone for unknown id (prevents re-appearance)', () => {
    const store = createExpensesSyncStore();
    store.tombstoneExpense('ghost-id');
    const ghost = store.getExpense('ghost-id');
    expect(ghost).toBeDefined();
    expect(ghost?.deletedAt).toBeTruthy();
  });
});

// ─── stampApplied ─────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — stampApplied', () => {
  it('updates version and updatedAt of a known record', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ version: 0 }));
    store.stampApplied('exp-001', 1, '2026-06-29T00:00:00Z');
    const item = store.getExpense('exp-001');
    expect(item?.version).toBe(1);
    expect(item?.updatedAt).toBe('2026-06-29T00:00:00Z');
  });

  it('is a no-op for unknown id', () => {
    const store = createExpensesSyncStore();
    expect(() => store.stampApplied('ghost', 1, '2026-06-29T00:00:00Z')).not.toThrow();
  });
});

// ─── adoptServerRecord ────────────────────────────────────────────────────────

describe('createExpensesSyncStore — adoptServerRecord', () => {
  it('replaces local record with server record', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ amount: 59000 }));
    const serverRecord = makeExpense({ amount: 80000, version: 2 });
    store.adoptServerRecord(serverRecord);
    expect(store.getExpense('exp-001')?.amount).toBe(80000);
  });
});

// ─── enqueueCreate ────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — enqueueCreate', () => {
  it('adds to pending count and local map', () => {
    const store = createExpensesSyncStore();
    store.enqueueCreate(makeExpense({ version: 0 }));
    expect(store.getPendingCount()).toBe(1);
    expect(store.getExpenses()).toHaveLength(1);
  });
});

// ─── enqueueUpdate ────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — enqueueUpdate', () => {
  it('updates local map and pending count', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense({ amount: 59000 }));
    store.enqueueUpdate(makeExpense({ amount: 80000 }));
    expect(store.getPendingCount()).toBe(1);
    expect(store.getExpense('exp-001')?.amount).toBe(80000);
  });
});

// ─── enqueueDelete ────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — enqueueDelete', () => {
  it('soft-deletes locally and adds to pending', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense());
    store.enqueueDelete('exp-001');
    expect(store.getPendingCount()).toBe(1);
    expect(store.getExpenses()).toHaveLength(0);
    expect(store.getExpense('exp-001')?.deletedAt).toBeTruthy();
  });
});

// ─── drainQueue ───────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — drainQueue', () => {
  it('returns SyncChangeSet with expenses key', () => {
    const store = createExpensesSyncStore();
    store.enqueueCreate(makeExpense({ version: 0 }));
    const cs = store.drainQueue();
    expect(cs.expenses).toBeDefined();
    expect(cs.expenses!.created).toHaveLength(1);
    expect(cs.expenses!.updated).toHaveLength(0);
    expect(cs.expenses!.deleted).toHaveLength(0);
  });

  it('clears pending queue after drain', () => {
    const store = createExpensesSyncStore();
    store.enqueueCreate(makeExpense({ version: 0 }));
    store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
  });

  it('puts enqueueDelete id in deleted array', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense());
    store.enqueueDelete('exp-001');
    const cs = store.drainQueue();
    expect(cs.expenses!.deleted).toContain('exp-001');
  });
});

// ─── reEnqueueChangeset ───────────────────────────────────────────────────────

describe('createExpensesSyncStore — reEnqueueChangeset', () => {
  it('restores drained items back into pending', () => {
    const store = createExpensesSyncStore();
    store.enqueueCreate(makeExpense({ version: 0 }));
    const cs = store.drainQueue();
    expect(store.getPendingCount()).toBe(0);
    store.reEnqueueChangeset(cs);
    expect(store.getPendingCount()).toBe(1);
  });

  it('is a no-op when changeset has no expenses', () => {
    const store = createExpensesSyncStore();
    store.reEnqueueChangeset({}); // no expenses key
    expect(store.getPendingCount()).toBe(0);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — reset', () => {
  it('clears items, queue, and watermark', () => {
    const store = createExpensesSyncStore();
    store.upsertExpense(makeExpense());
    store.enqueueCreate(makeExpense({ id: 'exp-002', version: 0 }));
    store.setWatermark('2026-06-29T00:00:00Z');
    store.reset();
    expect(store.getExpenses()).toHaveLength(0);
    expect(store.getPendingCount()).toBe(0);
    expect(store.getWatermark()).toBeUndefined();
  });
});

// ─── watermark ────────────────────────────────────────────────────────────────

describe('createExpensesSyncStore — watermark', () => {
  it('returns undefined before first pull', () => {
    const store = createExpensesSyncStore();
    expect(store.getWatermark()).toBeUndefined();
  });

  it('returns set watermark', () => {
    const store = createExpensesSyncStore();
    store.setWatermark('2026-06-29T10:00:00Z');
    expect(store.getWatermark()).toBe('2026-06-29T10:00:00Z');
  });
});
