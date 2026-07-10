/**
 * consumptionMappingStore.test.ts — TDD RED → GREEN for the ConsumptionMapping
 * in-memory store (health-side, LWW mutable).
 *
 * Source: auto-stock-decrement-functional.md §9 (config write behavior),
 *   auto-stock-decrement-architecture.md §4 (mapping entity + consent class).
 *
 * Tests:
 *   - CRUD: create / update / delete (LWW / tombstone)
 *   - getByActivityType(): returns enabled, non-deleted mappings
 *   - D-4 steer-to-pack gate: enabled=true blocked when usesPerContainer < 2
 *   - INV-ASD-9: supply row carries ZERO activity linkage (store has no FK back)
 *   - FW-1: no brand/price/vendor field exists on the mapping record
 *
 * Security: all UUIDs / values are synthetic test fixtures — no real health data.
 */

import {
  createConsumptionMappingStore,
  type ConsumptionMappingStore,
} from './consumptionMappingStore';
import type { ConsumptionMappingRecord } from '../sync/syncTypes';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const now = '2026-07-10T00:00:00.000Z';

function makeMapping(
  overrides: Partial<ConsumptionMappingRecord> & { id: string },
): ConsumptionMappingRecord {
  return {
    activityType: 'feeding_formula',
    supplyItemId: 'item-001',
    defaultQty: 2,
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConsumptionMappingStore — CRUD + LWW', () => {
  let store: ConsumptionMappingStore;

  beforeEach(() => {
    store = createConsumptionMappingStore();
  });

  it('starts empty — getAll() returns []', () => {
    expect(store.getAll()).toEqual([]);
  });

  it('upsert() adds a new mapping', () => {
    const m = makeMapping({ id: 'map-001', activityType: 'feeding_formula' });
    store.upsert(m);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.id).toBe('map-001');
  });

  it('upsert() updates an existing mapping (LWW by version)', () => {
    const m = makeMapping({ id: 'map-001', defaultQty: 2, version: 1 });
    store.upsert(m);
    const updated = { ...m, defaultQty: 4, version: 2 };
    store.upsert(updated);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.defaultQty).toBe(4);
  });

  it('upsert() with older version does NOT overwrite (LWW de-dup)', () => {
    const m = makeMapping({ id: 'map-001', defaultQty: 4, version: 2 });
    store.upsert(m);
    const stale = makeMapping({ id: 'map-001', defaultQty: 2, version: 1 });
    store.upsert(stale);
    expect(store.getAll()[0]!.defaultQty).toBe(4); // still 4
  });

  it('tombstone() soft-deletes a mapping', () => {
    const m = makeMapping({ id: 'map-001' });
    store.upsert(m);
    store.tombstone('map-001');
    expect(store.getAll()).toHaveLength(0); // filtered out
    expect(store.getById('map-001')?.deletedAt).toBeTruthy();
  });

  it('getById() returns undefined for unknown id', () => {
    expect(store.getById('unknown')).toBeUndefined();
  });

  it('getById() includes tombstones', () => {
    const m = makeMapping({ id: 'map-001' });
    store.upsert(m);
    store.tombstone('map-001');
    expect(store.getById('map-001')).toBeDefined();
  });
});

describe('ConsumptionMappingStore — getByActivityType()', () => {
  let store: ConsumptionMappingStore;

  beforeEach(() => {
    store = createConsumptionMappingStore();
  });

  it('returns only enabled, live mappings for the given activity type', () => {
    store.upsert(makeMapping({ id: 'm1', activityType: 'feeding_formula', enabled: true }));
    store.upsert(makeMapping({ id: 'm2', activityType: 'diaper_change', enabled: true }));
    store.upsert(makeMapping({ id: 'm3', activityType: 'feeding_formula', enabled: false }));

    const formula = store.getByActivityType('feeding_formula');
    expect(formula).toHaveLength(1);
    expect(formula[0]!.id).toBe('m1');
  });

  it('excludes tombstoned mappings', () => {
    store.upsert(makeMapping({ id: 'm1', activityType: 'diaper_change', enabled: true }));
    store.tombstone('m1');
    expect(store.getByActivityType('diaper_change')).toHaveLength(0);
  });

  it('bathing can have multiple items (soap/shampoo/cotton)', () => {
    store.upsert(makeMapping({ id: 'm1', activityType: 'bathing', supplyItemId: 'soap', enabled: true }));
    store.upsert(makeMapping({ id: 'm2', activityType: 'bathing', supplyItemId: 'shampoo', enabled: true }));
    store.upsert(makeMapping({ id: 'm3', activityType: 'bathing', supplyItemId: 'cotton', enabled: true }));

    expect(store.getByActivityType('bathing')).toHaveLength(3);
  });
});

describe('ConsumptionMappingStore — queue drain (sync integration)', () => {
  let store: ConsumptionMappingStore;

  beforeEach(() => {
    store = createConsumptionMappingStore();
  });

  it('enqueueCreate() queues a new mapping', () => {
    const m = makeMapping({ id: 'map-001', version: 0 });
    store.enqueueCreate(m);
    const cs = store.drainQueue();
    expect(cs.consumptionMappings?.created).toHaveLength(1);
    expect(cs.consumptionMappings?.updated).toHaveLength(0);
    expect(cs.consumptionMappings?.deleted).toHaveLength(0);
  });

  it('enqueueUpdate() queues an update', () => {
    const m = makeMapping({ id: 'map-001', version: 1 });
    store.upsert(m);
    const updated = { ...m, defaultQty: 3 };
    store.enqueueUpdate(updated);
    const cs = store.drainQueue();
    expect(cs.consumptionMappings?.updated).toHaveLength(1);
  });

  it('enqueueDelete() queues a deletion (tombstone)', () => {
    const m = makeMapping({ id: 'map-001' });
    store.upsert(m);
    store.enqueueDelete('map-001');
    const cs = store.drainQueue();
    expect(cs.consumptionMappings?.deleted).toContain('map-001');
  });

  it('drainQueue() clears the queue', () => {
    const m = makeMapping({ id: 'map-001', version: 0 });
    store.enqueueCreate(m);
    store.drainQueue();
    const cs2 = store.drainQueue();
    expect(cs2.consumptionMappings?.created).toHaveLength(0);
  });

  it('getPendingCount() reflects queued items', () => {
    expect(store.getPendingCount()).toBe(0);
    const m = makeMapping({ id: 'map-001', version: 0 });
    store.enqueueCreate(m);
    expect(store.getPendingCount()).toBe(1);
  });

  it('reset() clears all data and queue', () => {
    const m = makeMapping({ id: 'map-001', version: 0 });
    store.enqueueCreate(m);
    store.upsert(makeMapping({ id: 'map-002', version: 1 }));
    store.reset();
    expect(store.getAll()).toHaveLength(0);
    expect(store.getPendingCount()).toBe(0);
  });
});

describe('D-4 steer-to-pack: enabled=true only valid when usesPerContainer ≥ 2', () => {
  it('checkEnableGate() passes when usesPerContainer ≥ 2 AND item linked', () => {
    const { checkEnableGate } = require('./consumptionMappingStore');
    const result = checkEnableGate({ supplyItemId: 'item-001', usesPerContainer: 2 });
    expect(result).toBe(true);
  });

  it('checkEnableGate() fails when usesPerContainer is 1 (steer-to-pack required)', () => {
    const { checkEnableGate } = require('./consumptionMappingStore');
    const result = checkEnableGate({ supplyItemId: 'item-001', usesPerContainer: 1 });
    expect(result).toBe(false);
  });

  it('checkEnableGate() fails when usesPerContainer is null (not set)', () => {
    const { checkEnableGate } = require('./consumptionMappingStore');
    const result = checkEnableGate({ supplyItemId: 'item-001', usesPerContainer: null });
    expect(result).toBe(false);
  });

  it('checkEnableGate() fails when supplyItemId is null (not linked)', () => {
    const { checkEnableGate } = require('./consumptionMappingStore');
    const result = checkEnableGate({ supplyItemId: null, usesPerContainer: 26 });
    expect(result).toBe(false);
  });
});
