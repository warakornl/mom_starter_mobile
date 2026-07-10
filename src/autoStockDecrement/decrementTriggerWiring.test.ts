/**
 * decrementTriggerWiring.test.ts — Real integration tests for T-F and T-D
 * decrement trigger wiring.
 *
 * These tests exercise the WIRED PATH (real modules, real store state), not
 * pure-function tautologies. They prove:
 *
 *   T-F: commitFormulaFeedDecrement calls applyFormulaFeedTrigger and then
 *        writes the draw to the supply store when outcome=applied.
 *
 *   D-6 fail-on-revert: when the marker store throws on markSeen(), the
 *        draw is NOT applied to the supply store (net-zero), and a replay
 *        after simulated restart applies exactly one draw.
 *
 *   T-D: commitCareActivityDecrement calls applyCareActivityTrigger and
 *        writes all draw states to the supply store when outcome=applied.
 *        Multi-item exactly-once for T-D after restart.
 *
 *   INV-ASD-8 (egress): supplySyncStore.drainQueue() never includes
 *        usesRemainingInOpenContainer in any push payload.
 *
 * DI strategy:
 *   - Real createSyncStore() — not mocked (exercises the wired path).
 *   - Real createStockDecrementMarkerStore() for happy paths.
 *   - Throwing marker store for D-6 fail-on-revert tests.
 *   - Real createConsumptionMappingStore() with seeded records.
 *
 * Security: synthetic IDs only — no real health data.
 * NEVER log draw states or session IDs (SD-5 / K-8).
 */

import { createSyncStore } from '../sync/syncStore';
import { createStockDecrementMarkerStore } from './stockDecrementMarkerStore';
import { createConsumptionMappingStore } from './consumptionMappingStore';
import {
  commitFormulaFeedDecrement,
  commitCareActivityDecrement,
} from './decrementCommit';
import type { SupplyItemRecord, ConsumptionMappingRecord } from '../sync/syncTypes';
import type { StockDecrementMarkerStore } from './stockDecrementMarkerStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSupplyItem(overrides: Partial<SupplyItemRecord> = {}): SupplyItemRecord {
  const now = '2026-07-11T00:00:00Z';
  return {
    id: 'item-1',
    name: 'Formula tin',
    category: 'feeding',
    onHandQty: 3,
    usesPerContainer: 26, // 26 scoops per tin (spec deterministic check P=26)
    // Note: usesRemainingInOpenContainer is mobile-local-only; it is NOT set via
    // upsertSupplyItem (which strips it per INV-ASD-8 ingress sanitizer). Instead,
    // tests that need a specific initial draw position call applyDecrementDraw().
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMapping(overrides: Partial<ConsumptionMappingRecord> = {}): ConsumptionMappingRecord {
  const now = '2026-07-11T00:00:00Z';
  return {
    id: 'map-1',
    activityType: 'feeding_formula',
    supplyItemId: 'item-1',
    defaultQty: 4,
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCareMapping(
  activityType: 'diaper_change' | 'bathing',
  supplyItemId: string,
  id: string,
): ConsumptionMappingRecord {
  const now = '2026-07-11T00:00:00Z';
  return {
    id,
    activityType,
    supplyItemId,
    defaultQty: 1,
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** A marker store that throws on every markSeen() call (for D-6 rollback tests). */
function makeThrowingMarkerStore(): StockDecrementMarkerStore {
  return {
    hasSeen: () => false,
    markSeen: () => { throw new Error('simulated marker-write failure'); },
    getCount: () => 0,
    reset: () => {},
  };
}

// ─── T-F: formula-feed trigger wiring ────────────────────────────────────────

describe('[T-F] commitFormulaFeedDecrement — wired to supply store', () => {
  it('applies the draw to the supply store when consent + mapping are present', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem());
    // Seed mobile-local draw position: 20 scoops left in open tin.
    // In production, this is set by a prior applyDecrementDraw call (not by upsertSupplyItem,
    // which strips usesRemainingInOpenContainer per the INV-ASD-8 ingress sanitizer).
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping());

    const result = commitFormulaFeedDecrement({
      sessionId: 'sess-001',
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    expect(result.outcome).toBe('applied');

    // Draw applied: usesRemainingInOpenContainer reduced from 20 by 4 = 16
    const item = supplyStore.getSupplyItem('item-1')!;
    expect(item.usesRemainingInOpenContainer).toBe(16);
    // No container transition — onHandQty unchanged
    expect(item.onHandQty).toBe(3);
  });

  it('marker is recorded — second call with same sessionId returns already_seen', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem());
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping());

    const params = {
      sessionId: 'sess-idempotency',
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    };

    const r1 = commitFormulaFeedDecrement(params);
    const r2 = commitFormulaFeedDecrement(params);

    expect(r1.outcome).toBe('applied');
    expect(r2.outcome).toBe('already_seen');

    // Only ONE draw applied (idempotency): 20 - 4 = 16, not 12
    const item = supplyStore.getSupplyItem('item-1')!;
    expect(item.usesRemainingInOpenContainer).toBe(16);
  });

  it('null amountSubUnits falls back to mapping.defaultQty (D-2)', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem());
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping({ defaultQty: 6 }));

    const result = commitFormulaFeedDecrement({
      sessionId: 'sess-null-amount',
      amountSubUnits: null, // null → fallback to defaultQty=6
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    expect(result.outcome).toBe('applied');
    // 20 - 6 = 14 uses remaining
    expect(supplyStore.getSupplyItem('item-1')!.usesRemainingInOpenContainer).toBe(14);
  });

  it('container transition: onHandQty decrements and push is enqueued', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    // 2 scoops left in open tin (forces roll-over into next tin on draw of 4)
    supplyStore.upsertSupplyItem(makeSupplyItem({ onHandQty: 3, usesPerContainer: 26 }));
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 2, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping({ defaultQty: 4 }));

    const result = commitFormulaFeedDecrement({
      sessionId: 'sess-container-transition',
      amountSubUnits: 4, // > 2 remaining → rolls over
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    expect(result.outcome).toBe('applied');
    expect(result.containerTransitions).toBe(1);

    const item = supplyStore.getSupplyItem('item-1')!;
    // Rolled into next tin: onHandQty 3 → 2
    expect(item.onHandQty).toBe(2);
    // 2 drawn from open (2), then 2 drawn from new tin (26 → 24 remaining)
    expect(item.usesRemainingInOpenContainer).toBe(24); // 26 - (4 - 2) = 24

    // Container transition → push must be enqueued
    const changeset = supplyStore.drainQueue();
    const csUpdated = changeset.supplyItems!.updated;
    expect(csUpdated.length).toBe(1);
    expect(csUpdated[0]!.id).toBe('item-1');
  });

  it('consent_blocked: no draw, no marker when consent absent', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem());
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping());

    const result = commitFormulaFeedDecrement({
      sessionId: 'sess-no-consent',
      amountSubUnits: 4,
      consentInfantFeeding: false, // missing consent
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    expect(result.outcome).toBe('consent_blocked');
    expect(supplyStore.getSupplyItem('item-1')!.usesRemainingInOpenContainer).toBe(20); // unchanged (seeded via applyDecrementDraw)
    expect(markerStore.getCount()).toBe(0); // no marker
  });
});

// ─── D-6: fail-on-revert + simulated restart → exactly-once ──────────────────

describe('[D-6] fail-on-revert and simulated restart', () => {
  it('when markSeen throws: draw is NOT applied (net-zero)', () => {
    const supplyStore = createSyncStore();
    const throwingMarkerStore = makeThrowingMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem({ onHandQty: 3 }));
    // Seed: 20 scoops left in open tin (via applyDecrementDraw, the production path)
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping({ defaultQty: 4 }));

    const result = commitFormulaFeedDecrement({
      sessionId: 'sess-rollback',
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore: throwingMarkerStore,
    });

    expect(result.outcome).toBe('rollback');

    // Net-zero: store is unchanged after rollback
    const afterRollback = supplyStore.getSupplyItem('item-1')!;
    expect(afterRollback.usesRemainingInOpenContainer).toBe(20); // unchanged
    expect(afterRollback.onHandQty).toBe(3); // unchanged

    // No push enqueued
    expect(supplyStore.getPendingCount()).toBe(0);
  });

  it('after simulated restart: replay applies exactly ONE draw', () => {
    const SESSION_ID = 'sess-restart-idempotency';
    const initialItem = makeSupplyItem({ onHandQty: 3 }); // no usesRemainingInOpenContainer on server record

    // --- Session 1: rollback (marker write fails) ---
    const s1Store = createSyncStore();
    const s1Marker = makeThrowingMarkerStore();
    const s1Mappings = createConsumptionMappingStore();
    s1Store.upsertSupplyItem(initialItem);
    s1Store.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    s1Mappings.upsert(makeMapping({ defaultQty: 4 }));

    const r1 = commitFormulaFeedDecrement({
      sessionId: SESSION_ID,
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore: s1Store,
      consumptionMappingStore: s1Mappings,
      markerStore: s1Marker,
    });
    expect(r1.outcome).toBe('rollback');

    // --- Simulated restart: fresh stores (re-populated from server pull) ---
    const s2Store = createSyncStore();
    const s2Marker = createStockDecrementMarkerStore(); // fresh — no seen events
    const s2Mappings = createConsumptionMappingStore();
    s2Store.upsertSupplyItem(initialItem); // re-populated from pull (no usesRemainingInOpenContainer)
    // Note: after restart, usesRemainingInOpenContainer is undefined (server doesn't send it).
    // The first successful draw will set it. Starting from 0 (full unknown) is correct.
    s2Mappings.upsert(makeMapping({ defaultQty: 4 }));

    // --- Session 2: replay (same sessionId) → applied ---
    const r2 = commitFormulaFeedDecrement({
      sessionId: SESSION_ID,
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore: s2Store,
      consumptionMappingStore: s2Mappings,
      markerStore: s2Marker,
    });
    expect(r2.outcome).toBe('applied');

    // Exactly ONE draw applied. After restart usesRemainingInOpenContainer was undefined
    // (server pull never sends it), treated as 0. Draw of 4 from 0 → rolls into next tin:
    // onHandQty 3→2, usesRemainingInOpenContainer = 26 - 4 = 22.
    const afterReplay = s2Store.getSupplyItem('item-1')!;
    expect(afterReplay.usesRemainingInOpenContainer).toBe(22); // 26 - 4 after roll
    expect(afterReplay.onHandQty).toBe(2); // rolled one container

    // --- Same session again → already_seen (no second draw) ---
    const r3 = commitFormulaFeedDecrement({
      sessionId: SESSION_ID,
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore: s2Store,
      consumptionMappingStore: s2Mappings,
      markerStore: s2Marker,
    });
    expect(r3.outcome).toBe('already_seen');
    // Store still has exactly one draw (not doubled)
    expect(s2Store.getSupplyItem('item-1')!.usesRemainingInOpenContainer).toBe(22);
  });

  it('[T-D multi-item] care activity: all N draws fail-on-revert atomically', () => {
    const supplyStore = createSyncStore();
    const throwingMarkerStore = makeThrowingMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    // Two items for bathing (soap + shampoo)
    const soap = makeSupplyItem({ id: 'soap-1', name: 'Soap', usesPerContainer: 20, onHandQty: 2 });
    const shampoo = makeSupplyItem({ id: 'shampoo-1', name: 'Shampoo', usesPerContainer: 15, onHandQty: 2 });
    supplyStore.upsertSupplyItem(soap);
    supplyStore.upsertSupplyItem(shampoo);
    // Seed draw positions via applyDecrementDraw (production path)
    supplyStore.applyDecrementDraw('soap-1', { onHandQty: 2, usesRemaining: 15, usesPerContainer: 20 });
    supplyStore.applyDecrementDraw('shampoo-1', { onHandQty: 2, usesRemaining: 10, usesPerContainer: 15 });

    mappingStore.upsert(makeCareMapping('bathing', 'soap-1', 'map-bath-soap'));
    mappingStore.upsert(makeCareMapping('bathing', 'shampoo-1', 'map-bath-shampoo'));

    const result = commitCareActivityDecrement({
      occurrenceId: 'occ-bath-rollback',
      careActivityType: 'bathing',
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore: throwingMarkerStore,
    });

    expect(result.outcome).toBe('rollback');
    // Net-zero: BOTH items unchanged (draw not applied because marker failed)
    expect(supplyStore.getSupplyItem('soap-1')!.usesRemainingInOpenContainer).toBe(15);
    expect(supplyStore.getSupplyItem('shampoo-1')!.usesRemainingInOpenContainer).toBe(10);
    expect(supplyStore.getPendingCount()).toBe(0);
  });

  it('[T-D multi-item] after restart: replay applies exactly once for each item', () => {
    const OCC_ID = 'occ-bath-restart';
    // Server pull records: no usesRemainingInOpenContainer (stripped on ingress)
    const soapPull = makeSupplyItem({ id: 'soap-1', name: 'Soap', usesPerContainer: 20, onHandQty: 2 });
    const shampooPull = makeSupplyItem({ id: 'shampoo-1', name: 'Shampoo', usesPerContainer: 15, onHandQty: 2 });

    // Session 1: rollback
    const s1Store = createSyncStore();
    const s1Marker = makeThrowingMarkerStore();
    const s1Mappings = createConsumptionMappingStore();
    s1Store.upsertSupplyItem(soapPull);
    s1Store.upsertSupplyItem(shampooPull);
    // Seed draw positions
    s1Store.applyDecrementDraw('soap-1', { onHandQty: 2, usesRemaining: 15, usesPerContainer: 20 });
    s1Store.applyDecrementDraw('shampoo-1', { onHandQty: 2, usesRemaining: 10, usesPerContainer: 15 });
    s1Mappings.upsert(makeCareMapping('bathing', 'soap-1', 'map-bath-soap'));
    s1Mappings.upsert(makeCareMapping('bathing', 'shampoo-1', 'map-bath-shampoo'));

    const r1 = commitCareActivityDecrement({
      occurrenceId: OCC_ID,
      careActivityType: 'bathing',
      consentGeneralHealth: true,
      supplyStore: s1Store,
      consumptionMappingStore: s1Mappings,
      markerStore: s1Marker,
    });
    expect(r1.outcome).toBe('rollback');

    // Simulated restart: fresh stores (server pull re-populates items, no draw state)
    const s2Store = createSyncStore();
    const s2Marker = createStockDecrementMarkerStore();
    const s2Mappings = createConsumptionMappingStore();
    s2Store.upsertSupplyItem(soapPull);    // no usesRemainingInOpenContainer after restart
    s2Store.upsertSupplyItem(shampooPull); // no usesRemainingInOpenContainer after restart
    s2Mappings.upsert(makeCareMapping('bathing', 'soap-1', 'map-bath-soap'));
    s2Mappings.upsert(makeCareMapping('bathing', 'shampoo-1', 'map-bath-shampoo'));

    // Replay: applied. Starting from usesRemainingInOpenContainer=0 (undefined→0):
    // Draw 1 from 0 → rolls into next tin for each item.
    const r2 = commitCareActivityDecrement({
      occurrenceId: OCC_ID,
      careActivityType: 'bathing',
      consentGeneralHealth: true,
      supplyStore: s2Store,
      consumptionMappingStore: s2Mappings,
      markerStore: s2Marker,
    });
    expect(r2.outcome).toBe('applied');
    // Draw 1 from soap (usesRemaining=0→roll): onHandQty 2→1, usesRemaining = 20-1 = 19
    expect(s2Store.getSupplyItem('soap-1')!.usesRemainingInOpenContainer).toBe(19);
    // Draw 1 from shampoo (usesRemaining=0→roll): onHandQty 2→1, usesRemaining = 15-1 = 14
    expect(s2Store.getSupplyItem('shampoo-1')!.usesRemainingInOpenContainer).toBe(14);

    // Replay again → already_seen (no second draw)
    const r3 = commitCareActivityDecrement({
      occurrenceId: OCC_ID,
      careActivityType: 'bathing',
      consentGeneralHealth: true,
      supplyStore: s2Store,
      consumptionMappingStore: s2Mappings,
      markerStore: s2Marker,
    });
    expect(r3.outcome).toBe('already_seen');
    // Items still have exactly one draw (no additional decrement)
    expect(s2Store.getSupplyItem('soap-1')!.usesRemainingInOpenContainer).toBe(19);
    expect(s2Store.getSupplyItem('shampoo-1')!.usesRemainingInOpenContainer).toBe(14);
  });
});

// ─── T-D: care-activity trigger wiring ───────────────────────────────────────

describe('[T-D] commitCareActivityDecrement — wired to supply store', () => {
  it('applies draw to all enabled care-activity items', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    const diaper = makeSupplyItem({ id: 'diaper-1', name: 'Diaper', usesPerContainer: 30, onHandQty: 5 });
    supplyStore.upsertSupplyItem(diaper);
    // Seed: 25 uses remaining in open pack (via applyDecrementDraw)
    supplyStore.applyDecrementDraw('diaper-1', { onHandQty: 5, usesRemaining: 25, usesPerContainer: 30 });
    mappingStore.upsert(makeCareMapping('diaper_change', 'diaper-1', 'map-diaper'));

    const result = commitCareActivityDecrement({
      occurrenceId: 'occ-diaper-001',
      careActivityType: 'diaper_change',
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    expect(result.outcome).toBe('applied');
    const item = supplyStore.getSupplyItem('diaper-1')!;
    expect(item.usesRemainingInOpenContainer).toBe(24); // 25 - 1
    expect(item.onHandQty).toBe(5); // no container transition
  });

  it('not_care_activity when careActivityType is null', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    const result = commitCareActivityDecrement({
      occurrenceId: 'occ-null-type',
      careActivityType: null, // null = not a care activity (feeding reminder etc.)
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    expect(result.outcome).toBe('not_care_activity');
    expect(markerStore.getCount()).toBe(0);
  });

  it('D-1: isPulled=true → pulled_skip, no draw, no marker', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem({ id: 'diaper-1', name: 'D', usesPerContainer: 30, usesRemainingInOpenContainer: 25, onHandQty: 5 }));
    mappingStore.upsert(makeCareMapping('diaper_change', 'diaper-1', 'map-diaper'));

    const result = commitCareActivityDecrement({
      occurrenceId: 'occ-pulled',
      careActivityType: 'diaper_change',
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
      isPulled: true, // pulled from server — must not trigger (D-1)
    });

    expect(result.outcome).toBe('pulled_skip');
    expect(markerStore.getCount()).toBe(0);
  });
});

// ─── INV-ASD-8 egress sanitizer: drainQueue strips usesRemainingInOpenContainer ──

describe('[INV-ASD-8] supplySyncStore egress sanitizer', () => {
  it('drainQueue never includes usesRemainingInOpenContainer in push payload', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    supplyStore.upsertSupplyItem(makeSupplyItem());
    mappingStore.upsert(makeMapping({ defaultQty: 4 }));

    // Apply a draw that triggers a container transition (forces an enqueueUpdate)
    commitFormulaFeedDecrement({
      sessionId: 'sess-egress-test',
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    // Also enqueue via normal update path (SubUnitSetupScreen pattern)
    const item = supplyStore.getSupplyItem('item-1')!;
    supplyStore.enqueueUpdate({
      ...item,
      usesPerContainer: 30,
      version: item.version + 1,
      updatedAt: new Date().toISOString(),
    });

    const changeSet = supplyStore.drainQueue();
    const si = changeSet.supplyItems!;
    const allItems = [
      ...si.created,
      ...si.updated,
    ];

    for (const pushItem of allItems) {
      expect(Object.prototype.hasOwnProperty.call(pushItem, 'usesRemainingInOpenContainer')).toBe(false);
    }
  });

  it('drainQueue strips usesRemainingInOpenContainer even if item has it', () => {
    const supplyStore = createSyncStore();
    // Enqueue an item that explicitly has usesRemainingInOpenContainer
    supplyStore.enqueueCreate({
      id: 'item-strip',
      name: 'Test',
      category: 'other',
      onHandQty: 1,
      usesPerContainer: 5,
      usesRemainingInOpenContainer: 3, // should be stripped on egress
      version: 0,
      createdAt: '2026-07-11T00:00:00Z',
      updatedAt: '2026-07-11T00:00:00Z',
    });

    const changeSet = supplyStore.drainQueue();
    const pushed = changeSet.supplyItems!.created[0]!;
    expect(Object.prototype.hasOwnProperty.call(pushed, 'usesRemainingInOpenContainer')).toBe(false);
  });

  it('ingress: upsertSupplyItem strips server-provided usesRemainingInOpenContainer', () => {
    const supplyStore = createSyncStore();

    // Server sends a record with usesRemainingInOpenContainer (rogue/forward-compat)
    const serverRecord = {
      id: 'item-ingress',
      name: 'Test',
      category: 'other' as const,
      onHandQty: 5,
      usesPerContainer: 26,
      usesRemainingInOpenContainer: 999, // server should never send this — must be stripped
      version: 2,
      createdAt: '2026-07-11T00:00:00Z',
      updatedAt: '2026-07-11T00:00:00Z',
    };

    supplyStore.upsertSupplyItem(serverRecord);

    const stored = supplyStore.getSupplyItem('item-ingress')! as unknown as Record<string, unknown>;
    // Server-provided value must be stripped (undefined/absent)
    expect(stored['usesRemainingInOpenContainer']).toBeUndefined();
  });

  it('ingress preserves existing mobile-local usesRemainingInOpenContainer on update', () => {
    const supplyStore = createSyncStore();
    const markerStore = createStockDecrementMarkerStore();
    const mappingStore = createConsumptionMappingStore();

    // Step 1: item pulled from server (no usesRemainingInOpenContainer)
    supplyStore.upsertSupplyItem(makeSupplyItem());
    // Step 2: seed local draw position (production path: prior draw set it to 20)
    supplyStore.applyDecrementDraw('item-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    mappingStore.upsert(makeMapping({ defaultQty: 4 }));

    // Step 3: apply a local draw (20 → 16)
    commitFormulaFeedDecrement({
      sessionId: 'sess-preserve-local',
      amountSubUnits: 4,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      supplyStore,
      consumptionMappingStore: mappingStore,
      markerStore,
    });

    // Verify draw was applied
    expect(supplyStore.getSupplyItem('item-1')!.usesRemainingInOpenContainer).toBe(16);

    // Step 4: server pushes an update (name change, version bump, no usesRemainingInOpenContainer)
    const serverUpdate = {
      ...makeSupplyItem({ name: 'Formula tin (large)', version: 2, updatedAt: '2026-07-11T01:00:00Z' }),
      // Server record never includes usesRemainingInOpenContainer
    };
    delete (serverUpdate as Partial<SupplyItemRecord>).usesRemainingInOpenContainer;
    supplyStore.upsertSupplyItem(serverUpdate);

    // Mobile-local draw position should be preserved across server update
    const updated = supplyStore.getSupplyItem('item-1')!;
    expect(updated.usesRemainingInOpenContainer).toBe(16); // preserved from local draw
    expect(updated.name).toBe('Formula tin (large)'); // server update applied
  });
});
