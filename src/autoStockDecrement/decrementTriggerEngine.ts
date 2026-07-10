/**
 * decrementTriggerEngine.ts — T-F (formula-feed) and T-D (care-activity) decrement
 * trigger engines with D-6 atomicity enforcement.
 *
 * DESIGN:
 *   Both engines are PURE with respect to business logic (applyDraw, applySetCount)
 *   and use DEPENDENCY INJECTION for the StockDecrementMarkerStore so tests can
 *   inject a throwing store to prove D-6 rollback.
 *
 * D-6 ATOMICITY (BLOCKING invariant):
 *   The draw computation is pure (no side effects). The ONLY side effect is
 *   markSeen(). Atomicity is enforced as:
 *     1. Compute draw result (pure — no state mutation yet).
 *     2. try { markSeen(id) } — the only write.
 *     3. If markSeen throws: return 'rollback' with NO state changes (null nextDrawState).
 *     4. If markSeen succeeds: return 'applied' with the new computed draw states.
 *   This means a marker-write failure leaves BOTH the marker AND the draw state
 *   unchanged → a replay of the same event will re-apply correctly.
 *
 * INV-ASD-8 (covert channel):
 *   usesRemaining is MOBILE-LOCAL-ONLY. The containerTransitions field signals
 *   egress: 0 = no sync push needed; >0 = caller MUST push onHandQty to the API.
 *   A per-scoop draw within a container always yields containerTransitions=0.
 *
 * E-10 (skip-if-seen / idempotency):
 *   Keyed by the completion event id (FeedingSession.id / ReminderOccurrence.id).
 *   A second call with the same id immediately returns 'already_seen'; no recompute.
 *
 * D-3 (marker on every gate-admitted event):
 *   Even "no-op" outcomes (no mapping, no-pack-setup) record the marker so
 *   the event is not re-processed on replay.
 *
 * Security: NEVER log session/occurrence ids, draw amounts, or DrawState values
 *   (SD-5 / K-8 / INV-ASD-8).
 *
 * Source:
 *   auto-stock-decrement-functional.md §2 (T-F), §3 (T-D), §5 (algorithm),
 *   §6 (D-1…D-6), §8 (consent gate), architecture.md §3 (atomicity).
 */

import { applyDraw, type DrawState } from './containerHoldsNEngine';
import type { StockDecrementMarkerStore } from './stockDecrementMarkerStore';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Resolved mapping info passed by the caller (already looked up from mappingStore). */
export interface ResolvedMapping {
  readonly id: string;
  readonly supplyItemId: string | null | undefined;
  readonly defaultQty: number;
  readonly usesPerContainer: number;
}

/** Outcome tags for T-F and T-D results. */
export type TriggerOutcome =
  | 'pulled_skip'       // D-1: pulled event — skip entirely, no marker
  | 'consent_blocked'   // INV-ASD-1/3: missing required consent — no marker
  | 'already_seen'      // E-10: marker already recorded — skip
  | 'not_care_activity' // T-D only: careActivityType is null (feeding reminder, etc.)
  | 'no_mapping'        // E-2: no enabled mapping or null supplyItemId — marker recorded (D-3)
  | 'no_pack_setup'     // E-9/D-4: usesPerContainer < 2 at trigger time — marker recorded (D-3)
  | 'applied'           // Happy path: draw applied + marker recorded atomically (D-6)
  | 'rollback';         // D-6: marker write threw — draw NOT applied (whole side-effect rolled back)

/**
 * Result of a trigger engine call.
 *
 * For T-F: nextDrawState is set on 'applied'; null on rollback / skip.
 * For T-D: nextDrawStates map (empty on rollback / skip).
 */
export interface TriggerResult {
  readonly outcome: TriggerOutcome;
  /** Sum of container transitions across all items (signals sync egress). INV-ASD-8. */
  readonly containerTransitions: number;
  /** T-F: new draw state after the draw. null if not applied. */
  readonly nextDrawState: DrawState | null;
  /** T-D: new draw states keyed by supplyItemId. Empty map if not applied. */
  readonly nextDrawStates: Map<string, DrawState>;
}

// ─── T-F input ─────────────────────────────────────────────────────────────────

/** Input parameters for a formula-feed trigger call. */
export interface FormulaFeedTriggerInput {
  /** FeedingSession.id — idempotency key. NEVER log (K-8). */
  readonly sessionId: string;
  /**
   * Sub-units to draw (null = fall back to mapping.defaultQty; 0 = no-op draw).
   * NEVER log (K-8 / INV-ASD-8).
   */
  readonly amountSubUnits: number | null;
  /** User has granted infant_feeding consent. */
  readonly consentInfantFeeding: boolean;
  /** User has granted general_health consent. */
  readonly consentGeneralHealth: boolean;
  /** Resolved enabled ConsumptionMapping for feeding_formula activity (or null). */
  readonly enabledMapping: ResolvedMapping | null;
  /** Current DrawState for the linked supply item (null if no mapping/item). */
  readonly currentDrawState: DrawState | null;
  /** D-1: true if this FeedingSession was pulled from the server — skip entirely. */
  readonly isPulled: boolean;
}

// ─── T-D input ─────────────────────────────────────────────────────────────────

/** Input parameters for a care-activity (diaper/bathing) trigger call. */
export interface CareActivityTriggerInput {
  /** ReminderOccurrence.id — idempotency key. NEVER log (K-8). */
  readonly occurrenceId: string;
  /** Live-read from Reminder (M2). null means not a care activity. */
  readonly careActivityType: 'diaper_change' | 'bathing' | null;
  /** User has granted general_health consent. */
  readonly consentGeneralHealth: boolean;
  /**
   * All enabled ConsumptionMappings for the given careActivityType.
   * Multi-item for bathing (soap, shampoo, cotton pads, etc.).
   */
  readonly enabledMappings: ReadonlyArray<ResolvedMapping>;
  /**
   * Current DrawState for each supplyItemId in enabledMappings.
   * Key = supplyItemId.
   */
  readonly currentDrawStates: ReadonlyMap<string, DrawState>;
  /** D-1: true if this occurrence was pulled from the server — skip entirely. */
  readonly isPulled: boolean;
}

// ─── Helper: build empty result ────────────────────────────────────────────────

function emptyResult(outcome: TriggerOutcome): TriggerResult {
  return {
    outcome,
    containerTransitions: 0,
    nextDrawState: null,
    nextDrawStates: new Map(),
  };
}

// ─── T-F: formula-feed trigger ─────────────────────────────────────────────────

/**
 * Apply the T-F (formula-feed) decrement trigger.
 *
 * Gate order (spec §2, §6, §8):
 *   D-1  isPulled      → 'pulled_skip'       (no marker)
 *   §8   consent gate  → 'consent_blocked'   (no marker)
 *   E-10 hasSeen       → 'already_seen'
 *   E-2  no mapping    → 'no_mapping'         (marker recorded — D-3)
 *   E-9  usesPerC < 2  → 'no_pack_setup'      (marker recorded — D-3)
 *   D-2  null→default  (amount resolution)
 *   D-6  atomic block  → 'applied' or 'rollback'
 *
 * @param input       Resolved inputs (see FormulaFeedTriggerInput).
 * @param markerStore Injected store (DI for testing D-6 rollback).
 * @returns           TriggerResult.
 */
export function applyFormulaFeedTrigger(
  input: FormulaFeedTriggerInput,
  markerStore: StockDecrementMarkerStore,
): TriggerResult {
  const { sessionId, amountSubUnits, consentInfantFeeding, consentGeneralHealth,
          enabledMapping, currentDrawState, isPulled } = input;

  // ── D-1: pulled events never trigger (prevent double-count on pull). ──
  if (isPulled) {
    return emptyResult('pulled_skip');
  }

  // ── §8 Consent gate (INV-ASD-1): both infant_feeding AND general_health required. ──
  if (!consentInfantFeeding || !consentGeneralHealth) {
    return emptyResult('consent_blocked');
  }

  // ── E-10: skip-if-seen (keyed to sessionId). ──
  if (markerStore.hasSeen(sessionId)) {
    return emptyResult('already_seen');
  }

  // ── E-2: no mapping or no linked supply item. Record marker (D-3). ──
  if (!enabledMapping || !enabledMapping.supplyItemId) {
    // D-6 atomic: marker write for a no-mapping outcome.
    try {
      markerStore.markSeen(sessionId, 'infant_feeding');
    } catch {
      return emptyResult('rollback');
    }
    return emptyResult('no_mapping');
  }

  // ── E-9/D-4 trigger-time backstop: usesPerContainer < 2 → skip. Record marker (D-3). ──
  if (enabledMapping.usesPerContainer < 2) {
    try {
      markerStore.markSeen(sessionId, 'infant_feeding');
    } catch {
      return emptyResult('rollback');
    }
    return emptyResult('no_pack_setup');
  }

  // ── D-2: resolve effective amount (null → fallback to defaultQty; 0 = no-op). ──
  const effectiveAmount = amountSubUnits === null
    ? enabledMapping.defaultQty
    : amountSubUnits;

  // Defensive: currentDrawState must be non-null at this point (mapping is valid).
  const drawState = currentDrawState ?? {
    onHandQty: 0,
    usesRemaining: 0,
    usesPerContainer: enabledMapping.usesPerContainer,
  };

  // ── Compute the draw (PURE — no side effects yet). ──
  const drawResult = applyDraw(drawState, effectiveAmount);

  // ── D-6 ATOMIC BLOCK: markSeen + "commit" the draw result together. ──
  // If markSeen throws, we catch it and return 'rollback' with NO state change.
  // This ensures marker-write failure → draw is also rolled back (D-6).
  try {
    markerStore.markSeen(sessionId, 'infant_feeding');
  } catch {
    // D-6 rollback: marker write failed → entire side-effect discarded.
    return emptyResult('rollback');
  }

  // markSeen succeeded → "commit" the draw state.
  return {
    outcome: 'applied',
    containerTransitions: drawResult.containerTransitions,
    nextDrawState: drawResult.next,
    nextDrawStates: new Map(),
  };
}

// ─── T-D: care-activity trigger ───────────────────────────────────────────────

/**
 * Apply the T-D (care-activity: diaper_change / bathing) decrement trigger.
 *
 * Gate order (spec §3, §6, §8):
 *   M1   careActivityType null → 'not_care_activity' (no marker)
 *   D-1  isPulled              → 'pulled_skip'       (no marker)
 *   §8   consent gate          → 'consent_blocked'   (no marker)
 *   E-10 hasSeen               → 'already_seen'
 *   D-6  atomic block (multi-item):
 *         - compute all draws (pure)
 *         - try { markSeen } catch → 'rollback', nextDrawStates = empty
 *         - success → 'applied', nextDrawStates = all new states, ONE marker
 *
 * Multi-item note (E-7): bathing can have multiple mappings (soap, shampoo, etc.).
 * All draws are computed before the marker write; if the marker write fails,
 * ALL computed states are discarded (D-6: all-or-nothing per occurrence).
 *
 * US-AS6 (anti-double-count): feeding-type reminders have careActivityType=null
 * and are therefore inert in this engine. Their decrement goes through T-F.
 *
 * @param input       Resolved inputs (see CareActivityTriggerInput).
 * @param markerStore Injected store (DI for testing D-6 rollback).
 * @returns           TriggerResult.
 */
export function applyCareActivityTrigger(
  input: CareActivityTriggerInput,
  markerStore: StockDecrementMarkerStore,
): TriggerResult {
  const { occurrenceId, careActivityType, consentGeneralHealth,
          enabledMappings, currentDrawStates, isPulled } = input;

  // ── M1 entry gate: must be a recognized care activity (null = feeding, etc.). ──
  if (!careActivityType) {
    return emptyResult('not_care_activity');
  }

  // ── D-1: pulled events never trigger. ──
  if (isPulled) {
    return emptyResult('pulled_skip');
  }

  // ── §8 Consent gate (INV-ASD-3): general_health required for care activities. ──
  if (!consentGeneralHealth) {
    return emptyResult('consent_blocked');
  }

  // ── E-10: skip-if-seen (keyed to occurrenceId). ──
  if (markerStore.hasSeen(occurrenceId)) {
    return emptyResult('already_seen');
  }

  // ── Compute all draws (PURE — no side effects yet). ──
  // Process all enabled mappings that have a valid supplyItemId and usesPerContainer ≥ 2.
  let totalContainerTransitions = 0;
  const computedNextStates = new Map<string, DrawState>();

  for (const mapping of enabledMappings) {
    // E-2: skip items without a linked supply item.
    if (!mapping.supplyItemId) continue;

    // E-9/D-4 backstop: skip items with usesPerContainer < 2.
    if (mapping.usesPerContainer < 2) continue;

    const drawState = currentDrawStates.get(mapping.supplyItemId);
    if (!drawState) continue; // no state for this item → skip (defensive)

    const drawResult = applyDraw(drawState, mapping.defaultQty);
    totalContainerTransitions += drawResult.containerTransitions;
    computedNextStates.set(mapping.supplyItemId, drawResult.next);
  }

  // ── D-6 ATOMIC BLOCK: ONE marker for ALL items in this occurrence. ──
  // If markSeen throws → discard ALL computed state changes (zero net effect).
  try {
    markerStore.markSeen(occurrenceId, 'general_health');
  } catch {
    // D-6 rollback: marker write failed → entire side-effect discarded.
    return {
      outcome: 'rollback',
      containerTransitions: 0,
      nextDrawState: null,
      nextDrawStates: new Map(), // EMPTY: all computed draws discarded
    };
  }

  // markSeen succeeded → "commit" all draw states.
  return {
    outcome: 'applied',
    containerTransitions: totalContainerTransitions,
    nextDrawState: null,
    nextDrawStates: computedNextStates,
  };
}
