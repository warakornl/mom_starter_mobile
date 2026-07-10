/**
 * decrementCommit.ts — Production wiring for T-F and T-D decrement triggers.
 *
 * This module bridges the trigger engine (pure gate + draw compute + marker write)
 * and the supply store (applyDecrementDraw + enqueueUpdate for egress).
 *
 * D-6 ATOMICITY (in-memory simulation):
 *   The trigger engine (applyFormulaFeedTrigger / applyCareActivityTrigger) is
 *   responsible for:
 *     1. Gate evaluation (D-1, consent, E-10, E-2, E-9).
 *     2. Computing the draw (pure).
 *     3. Writing the StockDecrementMarker (the one write — may throw).
 *   This module is responsible for:
 *     4. Applying the computed draw to the supply store ONLY when outcome=applied.
 *     5. Enqueuing a push for container transitions (onHandQty change).
 *
 *   On outcome=rollback (marker write threw): nothing is written to the store.
 *   Net-zero is trivially guaranteed: the draw was never applied. After a
 *   simulated restart (stores reset + re-populated), a replay of the same
 *   event re-derives the same draw and applies exactly once (E-10).
 *
 * D-1 (local-only trigger):
 *   isPulled = true is forwarded to the engine's gate; the engine returns
 *   pulled_skip and this module does nothing. A sync/pull path MUST pass
 *   isPulled=true (default: false for local writes).
 *
 * INV-ASD-8 (sync split):
 *   applyDecrementDraw writes usesRemainingInOpenContainer (mobile-local only).
 *   enqueueUpdate is called ONLY for container transitions (onHandQty changes).
 *   drainQueue() strips usesRemainingInOpenContainer from the push payload.
 *
 * Security:
 *   NEVER log sessionId, occurrenceId, draw amounts, or DrawState values
 *   (SD-5 / K-8 / INV-ASD-8).
 *
 * Source:
 *   auto-stock-decrement-functional.md §2 (T-F), §3 (T-D), §6 (D-1…D-6),
 *   auto-stock-decrement-architecture.md §3 (atomicity), §7 (sequence).
 */

import {
  applyFormulaFeedTrigger,
  applyCareActivityTrigger,
  type TriggerResult,
} from './decrementTriggerEngine';
import type { SyncStore } from '../sync/syncStore';
import type { StockDecrementMarkerStore } from './stockDecrementMarkerStore';
import type { ConsumptionMappingStore } from './consumptionMappingStore';
import type { DrawState } from './containerHoldsNEngine';

// ─── T-F: formula-feed decrement commit ───────────────────────────────────────

export interface FormulaFeedCommitParams {
  /** FeedingSession.id — idempotency key. NEVER log (K-8). */
  readonly sessionId: string;
  /**
   * Sub-units to draw. null = fallback to mapping.defaultQty (D-2).
   * 0 = valid no-op draw (still records marker). NEVER log (K-8 / INV-ASD-8).
   */
  readonly amountSubUnits: number | null;
  /** User has granted infant_feeding consent (INV-ASD-1). */
  readonly consentInfantFeeding: boolean;
  /** User has granted general_health consent (INV-ASD-1). */
  readonly consentGeneralHealth: boolean;
  /** Supply store singleton (with applyDecrementDraw). */
  readonly supplyStore: SyncStore;
  /** ConsumptionMapping store singleton. */
  readonly consumptionMappingStore: ConsumptionMappingStore;
  /** Marker store singleton (injected for DI/testing). */
  readonly markerStore: StockDecrementMarkerStore;
  /**
   * D-1: true if this FeedingSession was pulled from the server (never triggers).
   * Defaults to false (local write path).
   */
  readonly isPulled?: boolean;
}

/**
 * Commit the T-F (formula-feed) decrement trigger.
 *
 * Steps:
 *   1. Resolve the enabled feeding_formula ConsumptionMapping from the store.
 *   2. Read the current DrawState for the linked supply item.
 *   3. Call applyFormulaFeedTrigger (engine evaluates gates + writes marker).
 *   4. On outcome=applied: apply the draw to the supply store.
 *   5. On container transition: enqueue a supply item push (INV-ASD-8).
 *
 * On outcome=rollback (marker threw): store is unchanged (net-zero).
 *
 * NEVER log any parameters or results (K-8 / SD-5 / INV-ASD-8).
 */
export function commitFormulaFeedDecrement(
  params: FormulaFeedCommitParams,
): TriggerResult {
  const {
    sessionId,
    amountSubUnits,
    consentInfantFeeding,
    consentGeneralHealth,
    supplyStore,
    consumptionMappingStore,
    markerStore,
    isPulled = false,
  } = params;

  // Resolve the enabled formula mapping (first enabled, non-tombstoned row).
  const mappings = consumptionMappingStore.getByActivityType('feeding_formula');
  const mapping = mappings[0] ?? null;

  // Resolve the supply item and its current draw state.
  const supplyItem = mapping?.supplyItemId
    ? supplyStore.getSupplyItem(mapping.supplyItemId)
    : undefined;

  const currentDrawState: DrawState | null = supplyItem
    ? {
        onHandQty: supplyItem.onHandQty,
        usesRemaining: supplyItem.usesRemainingInOpenContainer ?? 0,
        usesPerContainer: supplyItem.usesPerContainer ?? 1,
      }
    : null;

  // Build the resolved mapping for the engine.
  const resolvedMapping = mapping
    ? {
        id: mapping.id,
        supplyItemId: mapping.supplyItemId,
        defaultQty: mapping.defaultQty,
        usesPerContainer: supplyItem?.usesPerContainer ?? 1,
      }
    : null;

  // Invoke the trigger engine (handles all gates + marker write — D-6).
  const result = applyFormulaFeedTrigger(
    {
      sessionId,
      amountSubUnits,
      consentInfantFeeding,
      consentGeneralHealth,
      enabledMapping: resolvedMapping,
      currentDrawState,
      isPulled,
    },
    markerStore,
  );

  // D-6 commit step: on applied, persist the draw to the supply store.
  // On rollback (marker threw), skip — draw is NOT applied (net-zero).
  if (result.outcome === 'applied' && result.nextDrawState && mapping?.supplyItemId) {
    const itemId = mapping.supplyItemId;
    supplyStore.applyDecrementDraw(itemId, result.nextDrawState);

    // On container transition, enqueue push for the onHandQty change (INV-ASD-8).
    if (result.containerTransitions > 0) {
      const updatedItem = supplyStore.getSupplyItem(itemId);
      if (updatedItem) {
        supplyStore.enqueueUpdate(updatedItem);
      }
    }
  }

  return result;
}

// ─── T-D: care-activity decrement commit ──────────────────────────────────────

export interface CareActivityCommitParams {
  /** ReminderOccurrence.id — idempotency key. NEVER log (K-8). */
  readonly occurrenceId: string;
  /**
   * Live-read careActivityType from the Reminder at done-commit time (M2).
   * null = not a care activity (feeding reminder, appointment, etc.) → inert.
   */
  readonly careActivityType: 'diaper_change' | 'bathing' | null;
  /** User has granted general_health consent (INV-ASD-3). */
  readonly consentGeneralHealth: boolean;
  /** Supply store singleton (with applyDecrementDraw). */
  readonly supplyStore: SyncStore;
  /** ConsumptionMapping store singleton. */
  readonly consumptionMappingStore: ConsumptionMappingStore;
  /** Marker store singleton (injected for DI/testing). */
  readonly markerStore: StockDecrementMarkerStore;
  /**
   * D-1: true if this occurrence was pulled from the server (never triggers).
   * Defaults to false (local write path).
   */
  readonly isPulled?: boolean;
}

/**
 * Commit the T-D (care-activity: diaper_change / bathing) decrement trigger.
 *
 * Steps:
 *   1. Resolve all enabled ConsumptionMappings for the careActivityType.
 *   2. Read current DrawStates for all linked supply items.
 *   3. Call applyCareActivityTrigger (engine evaluates gates + writes ONE marker).
 *   4. On outcome=applied: apply all draws to their respective supply items.
 *   5. On container transitions: enqueue pushes for affected items (INV-ASD-8).
 *
 * On outcome=rollback (marker threw): store is unchanged (net-zero for ALL items).
 *
 * M2 (live careActivityType):
 *   careActivityType is passed as a parameter — callers MUST read it from the
 *   Reminder record at done-commit time, NOT from a cached/snapshot value.
 *
 * NEVER log any parameters or results (K-8 / SD-5 / INV-ASD-8).
 */
export function commitCareActivityDecrement(
  params: CareActivityCommitParams,
): TriggerResult {
  const {
    occurrenceId,
    careActivityType,
    consentGeneralHealth,
    supplyStore,
    consumptionMappingStore,
    markerStore,
    isPulled = false,
  } = params;

  // Resolve enabled mappings for the careActivityType.
  const enabledMappings = careActivityType
    ? consumptionMappingStore.getByActivityType(careActivityType).map((m) => {
        const supplyItem = m.supplyItemId
          ? supplyStore.getSupplyItem(m.supplyItemId)
          : undefined;
        return {
          id: m.id,
          supplyItemId: m.supplyItemId,
          defaultQty: m.defaultQty,
          usesPerContainer: supplyItem?.usesPerContainer ?? 1,
        };
      })
    : [];

  // Build currentDrawStates map (supplyItemId → DrawState) for the engine.
  const currentDrawStates = new Map<string, DrawState>();
  for (const m of enabledMappings) {
    if (m.supplyItemId) {
      const item = supplyStore.getSupplyItem(m.supplyItemId);
      if (item) {
        currentDrawStates.set(m.supplyItemId, {
          onHandQty: item.onHandQty,
          usesRemaining: item.usesRemainingInOpenContainer ?? 0,
          usesPerContainer: item.usesPerContainer ?? 1,
        });
      }
    }
  }

  // Invoke the trigger engine (handles all gates + ONE marker write — D-6).
  const result = applyCareActivityTrigger(
    {
      occurrenceId,
      careActivityType,
      consentGeneralHealth,
      enabledMappings,
      currentDrawStates,
      isPulled,
    },
    markerStore,
  );

  // D-6 commit step: on applied, persist all draws to the supply store.
  // On rollback (marker threw), skip — ALL draws are NOT applied (net-zero).
  if (result.outcome === 'applied') {
    for (const [itemId, nextState] of result.nextDrawStates) {
      supplyStore.applyDecrementDraw(itemId, nextState);

      // On container transition, enqueue push for the affected item (INV-ASD-8).
      const prevDrawState = currentDrawStates.get(itemId);
      if (prevDrawState && nextState.onHandQty !== prevDrawState.onHandQty) {
        const updatedItem = supplyStore.getSupplyItem(itemId);
        if (updatedItem) {
          supplyStore.enqueueUpdate(updatedItem);
        }
      }
    }
  }

  return result;
}
