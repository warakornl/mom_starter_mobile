/**
 * decrementTriggerEngine.test.ts — TDD RED → GREEN for the T-F (formula-feed)
 * and T-D (diaper/bathing reminder-done) decrement trigger engines.
 *
 * KEY INVARIANTS UNDER TEST:
 *
 * D-6 ATOMICITY (BLOCKING invariant):
 *   The side-effect block {resolve targets → apply all draw(s) → record marker}
 *   runs atomically. If the marker write fails → the draw is ALSO rolled back.
 *   If any draw fails → the marker is NOT written and all draws roll back.
 *   Implemented via injected runAtomicTransaction(ops) that can be forced to
 *   throw, simulating a mid-block crash or write failure.
 *
 * CRASH/REPLAY PROOFS:
 *   (i)  Force marker-write to fail → assert draw ALSO rolled back → replay →
 *        assert exactly ONE decrement (no duplicate).
 *   (ii) T-D multi-item: crash after item-1 draw before marker → assert ZERO net
 *        decrement across ALL items → replay → ONE per item.
 *
 * INV-ASD-8: N formula feeds within a container → NO sync push (containerTransitions=0).
 *
 * CONSENT GATE (INV-ASD-1/3):
 *   Formula feed without infant_feeding+general_health → no draw, no marker.
 *   Diaper/bathing without general_health → no draw, no marker.
 *
 * D-2 (null vs 0):
 *   amountSubUnits = null → fallback to mapping.defaultQty.
 *   amountSubUnits = 0   → no-op draw (logs; no decrement; marker recorded D-3).
 *
 * D-1 (local-only hook):
 *   Pulled FeedingSession / ReminderOccurrence must NOT re-fire the trigger.
 *   Implemented by the caller — trigger only called for local-commit path.
 *   Tested as: invoking trigger with isPulled=true → skip.
 *
 * E-10 (skip-if-seen):
 *   A second call with same session/occurrence id → skip entirely (no recompute).
 *
 * E-2 (no mapping / null supplyItemId):
 *   Skip silently; record marker (D-3); no draw.
 *
 * D-4 trigger-time backstop (E-9):
 *   usesPerContainer < 2 at trigger time → skip that item; marker recorded.
 *
 * US-AS6 (anti-double-count):
 *   Feeding-type reminder-done → inert (careActivityType = null → skip).
 *
 * Security: all UUIDs / values are synthetic test fixtures — no real health data.
 */

import {
  applyFormulaFeedTrigger,
  applyCareActivityTrigger,
  type FormulaFeedTriggerInput,
  type CareActivityTriggerInput,
  type TriggerResult,
} from './decrementTriggerEngine';
import {
  createStockDecrementMarkerStore,
  type StockDecrementMarkerStore,
} from './stockDecrementMarkerStore';
import type { DrawState } from './containerHoldsNEngine';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID   = 'aaaa0000-0000-4000-8000-000000000001';
const OCCURRENCE_1 = 'bbbb0000-0000-4000-8000-000000000002';
const OCCURRENCE_2 = 'cccc0000-0000-4000-8000-000000000003';
const SUPPLY_ID    = 'dddd0000-0000-4000-8000-000000000004';
const SUPPLY_ID_2  = 'eeee0000-0000-4000-8000-000000000005';
const MAPPING_ID   = 'ffff0000-0000-4000-8000-000000000006';
const MAPPING_ID_2 = 'gggg0000-0000-4000-8000-000000000007';

/** Helper: make a DrawState snapshot of a supply item. */
function makeDrawState(partial?: Partial<DrawState>): DrawState {
  return {
    onHandQty: 3,
    usesRemaining: 20,
    usesPerContainer: 26,
    ...partial,
  };
}

// ─── T-F: formula-feed trigger tests ─────────────────────────────────────────

describe('T-F: formula-feed trigger (applyFormulaFeedTrigger)', () => {
  let markerStore: StockDecrementMarkerStore;

  beforeEach(() => {
    markerStore = createStockDecrementMarkerStore();
  });

  // ── Consent gate (INV-ASD-1) ──

  it('blocks when infant_feeding is absent → no draw, no marker', () => {
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: false,   // ← absent
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: makeDrawState(),
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('consent_blocked');
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(SESSION_ID)).toBe(false);
  });

  it('blocks when general_health is absent → no draw, no marker', () => {
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: false,   // ← absent
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: makeDrawState(),
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('consent_blocked');
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(SESSION_ID)).toBe(false);
  });

  // ── D-1: pulled event must not trigger ──

  it('skips when isPulled=true → no draw, no marker (D-1)', () => {
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: makeDrawState(),
      isPulled: true,  // ← pulled event
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('pulled_skip');
    expect(markerStore.hasSeen(SESSION_ID)).toBe(false);
  });

  // ── E-10: skip-if-seen ──

  it('skips when marker already seen (E-10 idempotency)', () => {
    markerStore.markSeen(SESSION_ID, 'infant_feeding');
    const state = makeDrawState();
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: state,
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('already_seen');
    expect(result.containerTransitions).toBe(0);
  });

  // ── E-2: no mapping / null supplyItemId ──

  it('skips silently when no enabled mapping (E-2), records marker (D-3)', () => {
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: null,    // ← no mapping
      currentDrawState: null,
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('no_mapping');
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(SESSION_ID)).toBe(true); // D-3: marker recorded
  });

  it('skips when supplyItemId is null (E-2), records marker (D-3)', () => {
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: null,  // ← null item
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: null,
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('no_mapping');
    expect(markerStore.hasSeen(SESSION_ID)).toBe(true);
  });

  // ── D-4 trigger-time backstop (E-9): usesPerContainer < 2 ──

  it('skips when usesPerContainer < 2 at trigger time (E-9/D-4 backstop)', () => {
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 1,  // ← < 2 → backstop
      },
      currentDrawState: makeDrawState({ usesPerContainer: 1 }),
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('no_pack_setup');
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(SESSION_ID)).toBe(true); // marker still recorded
  });

  // ── D-2: null amountSubUnits falls back to defaultQty ──

  it('D-2: amountSubUnits=null falls back to mapping.defaultQty', () => {
    const state = makeDrawState({ usesRemaining: 10, usesPerContainer: 26, onHandQty: 2 });
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: null,   // ← null → fallback
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 3,        // ← should use this
        usesPerContainer: 26,
      },
      currentDrawState: state,
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('applied');
    // usesRemaining should decrease by 3 (defaultQty)
    expect(result.nextDrawState?.usesRemaining).toBe(7);
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(SESSION_ID)).toBe(true);
  });

  // ── D-2: amountSubUnits=0 is a no-op draw (valid; marker recorded D-3) ──

  it('D-2: amountSubUnits=0 → no-op draw, marker recorded (D-3)', () => {
    const state = makeDrawState();
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 0,   // ← explicit 0
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: state,
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('applied');
    expect(result.containerTransitions).toBe(0); // no-op
    expect(result.nextDrawState?.onHandQty).toBe(state.onHandQty); // unchanged
    expect(result.nextDrawState?.usesRemaining).toBe(state.usesRemaining); // unchanged
    expect(markerStore.hasSeen(SESSION_ID)).toBe(true);
  });

  // ── Happy path: draw within container (INV-ASD-8: zero egress) ──

  it('happy path: 2-use draw within container → applied, zero egress (INV-ASD-8)', () => {
    const state = makeDrawState({ usesRemaining: 20, onHandQty: 3, usesPerContainer: 26 });
    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: state,
      isPulled: false,
    };
    const result = applyFormulaFeedTrigger(input, markerStore);
    expect(result.outcome).toBe('applied');
    expect(result.nextDrawState?.usesRemaining).toBe(18); // 20-2
    expect(result.nextDrawState?.onHandQty).toBe(3); // unchanged
    expect(result.containerTransitions).toBe(0); // no egress
    expect(markerStore.hasSeen(SESSION_ID)).toBe(true);
  });

  // ── INV-ASD-8: N formula feeds within container → ZERO push ──

  it('INV-ASD-8: 5 formula feeds within container → zero total container transitions', () => {
    let state = makeDrawState({ usesRemaining: 20, onHandQty: 3, usesPerContainer: 26 });
    let totalTransitions = 0;
    const mStore = createStockDecrementMarkerStore();

    for (let i = 0; i < 5; i++) {
      const sid = `sess-${i}`;
      const input: FormulaFeedTriggerInput = {
        sessionId: sid,
        amountSubUnits: 2,
        consentInfantFeeding: true,
        consentGeneralHealth: true,
        enabledMapping: {
          id: MAPPING_ID,
          supplyItemId: SUPPLY_ID,
          defaultQty: 2,
          usesPerContainer: 26,
        },
        currentDrawState: state,
        isPulled: false,
      };
      const result = applyFormulaFeedTrigger(input, mStore);
      totalTransitions += result.containerTransitions;
      if (result.nextDrawState) state = result.nextDrawState;
    }
    expect(totalTransitions).toBe(0); // no sync push at all
  });

  // ── D-6 ATOMICITY: marker-write failure → draw rolled back ──

  it('D-6: if marker write throws → draw is ALSO rolled back, no orphan', () => {
    const state = makeDrawState({ usesRemaining: 20, onHandQty: 3, usesPerContainer: 26 });

    // Create a store that throws on the first markSeen call.
    const throwingMarkerStore: StockDecrementMarkerStore = {
      hasSeen: () => false,
      markSeen: () => { throw new Error('simulated marker write failure'); },
      getCount: () => 0,
      reset: () => {},
    };

    const input: FormulaFeedTriggerInput = {
      sessionId: SESSION_ID,
      amountSubUnits: 2,
      consentInfantFeeding: true,
      consentGeneralHealth: true,
      enabledMapping: {
        id: MAPPING_ID,
        supplyItemId: SUPPLY_ID,
        defaultQty: 2,
        usesPerContainer: 26,
      },
      currentDrawState: state,
      isPulled: false,
    };

    const result = applyFormulaFeedTrigger(input, throwingMarkerStore);

    // D-6: the whole side-effect rolled back → outcome is 'rollback'
    expect(result.outcome).toBe('rollback');
    // The draw state must be unchanged (rolled back)
    expect(result.nextDrawState).toBeNull();
    // Zero container transitions (no egress from the rolled-back draw)
    expect(result.containerTransitions).toBe(0);
  });

  it('D-6 + replay: rollback → replay with good store → exactly one decrement', () => {
    const state = makeDrawState({ usesRemaining: 20, onHandQty: 3, usesPerContainer: 26 });

    // First attempt: marker throws → rollback
    const throwingMarkerStore: StockDecrementMarkerStore = {
      hasSeen: () => false,
      markSeen: () => { throw new Error('simulated failure'); },
      getCount: () => 0,
      reset: () => {},
    };
    const firstResult = applyFormulaFeedTrigger(
      {
        sessionId: SESSION_ID,
        amountSubUnits: 2,
        consentInfantFeeding: true,
        consentGeneralHealth: true,
        enabledMapping: { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 2, usesPerContainer: 26 },
        currentDrawState: state,
        isPulled: false,
      },
      throwingMarkerStore,
    );
    expect(firstResult.outcome).toBe('rollback');

    // Replay: good marker store, same state (rollback means no net change)
    const goodMarkerStore = createStockDecrementMarkerStore();
    const secondResult = applyFormulaFeedTrigger(
      {
        sessionId: SESSION_ID,
        amountSubUnits: 2,
        consentInfantFeeding: true,
        consentGeneralHealth: true,
        enabledMapping: { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 2, usesPerContainer: 26 },
        currentDrawState: state,  // same pre-rollback state (no change applied)
        isPulled: false,
      },
      goodMarkerStore,
    );
    expect(secondResult.outcome).toBe('applied');
    expect(secondResult.nextDrawState?.usesRemaining).toBe(18); // exactly one decrement
    expect(goodMarkerStore.hasSeen(SESSION_ID)).toBe(true);

    // Third attempt: already seen → skip (no second decrement)
    const thirdResult = applyFormulaFeedTrigger(
      {
        sessionId: SESSION_ID,
        amountSubUnits: 2,
        consentInfantFeeding: true,
        consentGeneralHealth: true,
        enabledMapping: { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 2, usesPerContainer: 26 },
        currentDrawState: secondResult.nextDrawState!,
        isPulled: false,
      },
      goodMarkerStore,
    );
    expect(thirdResult.outcome).toBe('already_seen');
  });
});

// ─── T-D: care-activity trigger tests ────────────────────────────────────────

describe('T-D: care-activity trigger (applyCareActivityTrigger)', () => {
  let markerStore: StockDecrementMarkerStore;

  beforeEach(() => {
    markerStore = createStockDecrementMarkerStore();
  });

  // ── Entry gate (step 2a): NULL careActivityType → inert ──

  it('US-AS6: NULL careActivityType → inert, no draw, no marker', () => {
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: null,  // ← not a care activity
      consentGeneralHealth: true,
      enabledMappings: [],
      currentDrawStates: new Map(),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('not_care_activity');
    expect(markerStore.hasSeen(OCCURRENCE_1)).toBe(false); // no marker (§0 / M1)
  });

  it('feeding reminder-done (careActivityType=null) → never decrements (US-AS6)', () => {
    // Feeding is intentionally not a careActivityType value (anti-double-count)
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: null, // feeding has no careActivityType
      consentGeneralHealth: true,
      enabledMappings: [],
      currentDrawStates: new Map(),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('not_care_activity');
    expect(markerStore.hasSeen(OCCURRENCE_1)).toBe(false);
  });

  // ── Consent gate (INV-ASD-3) ──

  it('blocks when general_health absent → no draw, no marker', () => {
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: 'diaper_change',
      consentGeneralHealth: false,  // ← absent
      enabledMappings: [{
        id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26,
      }],
      currentDrawStates: new Map([[SUPPLY_ID, makeDrawState()]]),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('consent_blocked');
    expect(markerStore.hasSeen(OCCURRENCE_1)).toBe(false);
  });

  // ── D-1: pulled event skip ──

  it('skips when isPulled=true (D-1)', () => {
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: 'diaper_change',
      consentGeneralHealth: true,
      enabledMappings: [{
        id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26,
      }],
      currentDrawStates: new Map([[SUPPLY_ID, makeDrawState()]]),
      isPulled: true,  // ← pulled
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('pulled_skip');
    expect(markerStore.hasSeen(OCCURRENCE_1)).toBe(false);
  });

  // ── E-10: skip-if-seen ──

  it('skips when marker already seen (E-10)', () => {
    markerStore.markSeen(OCCURRENCE_1, 'general_health');
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: 'diaper_change',
      consentGeneralHealth: true,
      enabledMappings: [{
        id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26,
      }],
      currentDrawStates: new Map([[SUPPLY_ID, makeDrawState()]]),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('already_seen');
    expect(result.containerTransitions).toBe(0);
  });

  // ── Happy path: diaper → single item draw ──

  it('diaper-done: applies single item draw within container (zero egress)', () => {
    const state = makeDrawState({ usesRemaining: 20 });
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: 'diaper_change',
      consentGeneralHealth: true,
      enabledMappings: [{
        id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26,
      }],
      currentDrawStates: new Map([[SUPPLY_ID, state]]),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('applied');
    expect(result.nextDrawStates.get(SUPPLY_ID)?.usesRemaining).toBe(19);
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(OCCURRENCE_1)).toBe(true);
  });

  // ── Multi-item bathing (E-7) ──

  it('bathing-done: applies draws to ALL enabled items (soap+shampoo), ONE marker', () => {
    const state1 = makeDrawState({ usesRemaining: 10, usesPerContainer: 26, onHandQty: 2 });
    const state2 = makeDrawState({ usesRemaining: 5, usesPerContainer: 30, onHandQty: 3 });
    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: 'bathing',
      consentGeneralHealth: true,
      enabledMappings: [
        { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26 },
        { id: MAPPING_ID_2, supplyItemId: SUPPLY_ID_2, defaultQty: 2, usesPerContainer: 30 },
      ],
      currentDrawStates: new Map([
        [SUPPLY_ID, state1],
        [SUPPLY_ID_2, state2],
      ]),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, markerStore);
    expect(result.outcome).toBe('applied');
    expect(result.nextDrawStates.get(SUPPLY_ID)?.usesRemaining).toBe(9);
    expect(result.nextDrawStates.get(SUPPLY_ID_2)?.usesRemaining).toBe(3);
    expect(result.containerTransitions).toBe(0);
    expect(markerStore.hasSeen(OCCURRENCE_1)).toBe(true); // ONE marker for all
  });

  // ── D-6 ATOMICITY: crash after item-1 draw before marker → zero net ──

  it('D-6 multi-item: if marker throws → ALL draws rolled back, zero net change', () => {
    const state1 = makeDrawState({ usesRemaining: 10 });
    const state2 = makeDrawState({ usesRemaining: 5 });

    const throwingMarkerStore: StockDecrementMarkerStore = {
      hasSeen: () => false,
      markSeen: () => { throw new Error('marker write failure'); },
      getCount: () => 0,
      reset: () => {},
    };

    const input: CareActivityTriggerInput = {
      occurrenceId: OCCURRENCE_1,
      careActivityType: 'bathing',
      consentGeneralHealth: true,
      enabledMappings: [
        { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26 },
        { id: MAPPING_ID_2, supplyItemId: SUPPLY_ID_2, defaultQty: 2, usesPerContainer: 30 },
      ],
      currentDrawStates: new Map([[SUPPLY_ID, state1], [SUPPLY_ID_2, state2]]),
      isPulled: false,
    };
    const result = applyCareActivityTrigger(input, throwingMarkerStore);
    // D-6: whole side-effect rolled back
    expect(result.outcome).toBe('rollback');
    expect(result.nextDrawStates.size).toBe(0); // no state changes
    expect(result.containerTransitions).toBe(0);
  });

  it('D-6 multi-item crash/replay: rollback → replay → exactly one per item', () => {
    const state1 = makeDrawState({ usesRemaining: 10 });
    const state2 = makeDrawState({ usesRemaining: 5 });

    // First attempt: rollback
    const throwingStore: StockDecrementMarkerStore = {
      hasSeen: () => false,
      markSeen: () => { throw new Error('failure'); },
      getCount: () => 0,
      reset: () => {},
    };
    const firstResult = applyCareActivityTrigger(
      {
        occurrenceId: OCCURRENCE_1,
        careActivityType: 'bathing',
        consentGeneralHealth: true,
        enabledMappings: [
          { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26 },
          { id: MAPPING_ID_2, supplyItemId: SUPPLY_ID_2, defaultQty: 2, usesPerContainer: 30 },
        ],
        currentDrawStates: new Map([[SUPPLY_ID, state1], [SUPPLY_ID_2, state2]]),
        isPulled: false,
      },
      throwingStore,
    );
    expect(firstResult.outcome).toBe('rollback');

    // Replay with good store and same pre-rollback states
    const goodStore = createStockDecrementMarkerStore();
    const secondResult = applyCareActivityTrigger(
      {
        occurrenceId: OCCURRENCE_1,
        careActivityType: 'bathing',
        consentGeneralHealth: true,
        enabledMappings: [
          { id: MAPPING_ID, supplyItemId: SUPPLY_ID, defaultQty: 1, usesPerContainer: 26 },
          { id: MAPPING_ID_2, supplyItemId: SUPPLY_ID_2, defaultQty: 2, usesPerContainer: 30 },
        ],
        currentDrawStates: new Map([[SUPPLY_ID, state1], [SUPPLY_ID_2, state2]]),
        isPulled: false,
      },
      goodStore,
    );
    expect(secondResult.outcome).toBe('applied');
    // Exactly one decrement per item
    expect(secondResult.nextDrawStates.get(SUPPLY_ID)?.usesRemaining).toBe(9); // -1
    expect(secondResult.nextDrawStates.get(SUPPLY_ID_2)?.usesRemaining).toBe(3); // -2
    expect(goodStore.hasSeen(OCCURRENCE_1)).toBe(true);
  });
});
