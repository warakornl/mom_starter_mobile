/**
 * containerHoldsNEngine.ts — Pure container-holds-N sub-unit draw algorithm.
 *
 * Source of truth: auto-stock-decrement-functional.md §5 (algorithm §5.2,
 * invariants §5.1, edge behaviors §5.3, deterministic checks A–E §5.4).
 *
 * KEY DESIGN PRINCIPLES:
 *   - PURE FUNCTIONS ONLY — no side effects, no stores, no React imports.
 *   - All state transitions return a new state object (immutable).
 *   - containerTransitions count drives sync egress — a non-zero value means
 *     the caller MUST enqueue a supplyItems push (INV-ASD-8).
 *   - usesRemaining is MOBILE-LOCAL-ONLY — never in any output payload.
 *   - Integer-only arithmetic (spec §10); no floats.
 *
 * Exported functions:
 *   applyDraw(state, amount)               — T-F / T-D decrement
 *   applySetCount(state, newOnHandQty)     — manual "set count" / restock
 *   applyUsesPerContainerChange(state, P') — config edit; clamps usesRemaining
 *   applyPullOnHandQty(state, pulledQty)   — handle an inbound sync/pull update
 *
 * Security: NEVER log DrawState values — they contain health-adjacent sub-unit
 * position data (INV-ASD-8 / K-8 / SD-5).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * DrawState — the mobile-local view of one supply item's container sub-unit state.
 *
 * onHandQty          = container_count (SYNCED; ≥ 0).
 * usesRemaining      = usesRemainingInOpenContainer (MOBILE-LOCAL-ONLY; 0…usesPerContainer).
 * usesPerContainer   = P (SYNCED config; ≥ 1).
 *
 * NEVER log any field of this struct (INV-ASD-8 / K-8 / SD-5).
 */
export interface DrawState {
  readonly onHandQty: number;
  readonly usesRemaining: number;
  readonly usesPerContainer: number;
}

/**
 * DrawResult — outcome of a pure draw operation.
 *
 * next               — new state after the draw.
 * containerTransitions — number of container rolls; > 0 means the caller MUST
 *                        enqueue a supplyItems push (INV-ASD-8).
 * remainderDropped   — uses that were requested but could not be satisfied
 *                      (clamped at the last container — E-1). Always ≥ 0.
 */
export interface DrawResult {
  readonly next: DrawState;
  readonly containerTransitions: number;
  readonly remainderDropped: number;
}

// ─── applyDraw ───────────────────────────────────────────────────────────────

/**
 * Apply a sub-unit draw of `amount` uses from the current state.
 *
 * Implements the LAZY roll-over, remainder-carries algorithm from §5.2:
 *
 *   draw = min(amount, usesRemaining)
 *   usesRemaining -= draw
 *   k -= draw
 *   while k > 0:
 *       if onHandQty >= 2:           # sealed container exists
 *           onHandQty -= 1           # CONTAINER TRANSITION (egresses)
 *           usesRemaining = P        # refill freshly opened
 *           step = min(k, usesRemaining)
 *           usesRemaining -= step
 *           k -= step
 *       else:                        # last container (onHandQty == 1)
 *           onHandQty = 0            # CONTAINER TRANSITION (egresses)
 *           usesRemaining = 0        # floor; drop remainder
 *           k = 0                    # stop
 *
 * Invariants maintained:
 *   INV-COH-A: onHandQty = 0 ⇒ usesRemaining = 0
 *   INV-COH-B: 0 ≤ usesRemaining ≤ usesPerContainer
 *   INV-CLAMP: no negative values
 *
 * E-1 (clamp at last container): when onHandQty becomes 0, remaining demand
 * is dropped (remainderDropped > 0 in this case). Activity still logs.
 * E-8 (lazy roll-over): usesRemaining=0 by itself never rolls; roll fires
 * only when k > 0 (there is actual demand).
 *
 * @param state  Current DrawState (immutable input).
 * @param amount Non-negative integer uses demanded (0 = no-op draw, valid).
 * @returns      DrawResult with next state + egress signal.
 */
export function applyDraw(state: DrawState, amount: number): DrawResult {
  // Guard: no-op draw (amount=0 is valid — D-2/E-1; still records marker).
  if (amount <= 0) {
    return { next: { ...state }, containerTransitions: 0, remainderDropped: 0 };
  }

  const P = state.usesPerContainer;
  let onHandQty = state.onHandQty;
  let usesRemaining = state.usesRemaining;
  let k = amount;
  let containerTransitions = 0;

  // First: consume from the currently open container.
  const draw = Math.min(k, usesRemaining);
  usesRemaining -= draw;
  k -= draw;

  // Then: roll into sealed containers while demand remains.
  while (k > 0) {
    if (onHandQty >= 2) {
      // A sealed container exists — roll over.
      onHandQty -= 1; // CONTAINER TRANSITION (egresses)
      containerTransitions += 1;
      usesRemaining = P; // refill freshly opened
      const step = Math.min(k, usesRemaining);
      usesRemaining -= step;
      k -= step;
    } else {
      // onHandQty === 1: the open one is the last container.
      // E-1: discard rest, clamp at 0.
      onHandQty = 0; // CONTAINER TRANSITION (egresses)
      containerTransitions += 1;
      const dropped = k;
      usesRemaining = 0;
      k = 0;
      // Return directly so we carry the dropped count through.
      return {
        next: { onHandQty, usesRemaining, usesPerContainer: P },
        containerTransitions,
        remainderDropped: dropped,
      };
    }
  }

  // INV-COH-A: if somehow onHandQty = 0, force usesRemaining = 0.
  if (onHandQty === 0) {
    usesRemaining = 0;
  }

  return {
    next: { onHandQty, usesRemaining, usesPerContainer: P },
    containerTransitions,
    remainderDropped: 0,
  };
}

// ─── applySetCount ───────────────────────────────────────────────────────────

/**
 * Apply a manual "set count" or restock (changes onHandQty to newOnHandQty).
 *
 * Behavior (functional §5.3 / §4.3 screens):
 *   newOnHandQty = 0 → usesRemaining forced to 0 (INV-COH-A / E-11).
 *   newOnHandQty ≥ 1 → usesRemaining untouched (spec §5.3 check C).
 *   Any onHandQty change = 1 container transition (the set-count itself egresses).
 *
 * The set-count is a SYNCED container-level change (onHandQty is SYNCED).
 * It always egresses once (the new onHandQty value), regardless of whether
 * it increased or decreased.
 *
 * @param state         Current DrawState.
 * @param newOnHandQty  Target container count (int ≥ 0).
 * @returns             DrawResult (containerTransitions = 1 always for a set-count).
 */
export function applySetCount(state: DrawState, newOnHandQty: number): DrawResult {
  const P = state.usesPerContainer;
  const clamped = Math.max(0, Math.floor(newOnHandQty));

  let usesRemaining = state.usesRemaining;
  if (clamped === 0) {
    // INV-COH-A / E-11: zero containers → no open container position.
    usesRemaining = 0;
  }
  // newOnHandQty ≥ 1 → usesRemaining untouched (check C).

  return {
    next: { onHandQty: clamped, usesRemaining, usesPerContainer: P },
    containerTransitions: 1, // the set-count itself is always a synced container change
    remainderDropped: 0,
  };
}

// ─── applyUsesPerContainerChange ─────────────────────────────────────────────

/**
 * Apply a config change to usesPerContainer (P).
 *
 * INV-COH-B: clamp usesRemaining to [0, newP] immediately.
 * A P change is a config edit (SYNCED for usesPerContainer field), so it
 * produces a container transition for egress purposes.
 *
 * @param state  Current DrawState.
 * @param newP   New usesPerContainer value (int ≥ 1).
 * @returns      DrawResult with clamped usesRemaining.
 */
export function applyUsesPerContainerChange(
  state: DrawState,
  newP: number,
): DrawResult {
  const P = Math.max(1, Math.floor(newP));
  // INV-COH-B: clamp usesRemaining to [0, newP].
  const usesRemaining = Math.min(state.usesRemaining, P);

  return {
    next: { onHandQty: state.onHandQty, usesRemaining, usesPerContainer: P },
    containerTransitions: 1, // usesPerContainer change is a synced config field change
    remainderDropped: 0,
  };
}

// ─── applyPullOnHandQty ──────────────────────────────────────────────────────

/**
 * Handle a sync/pull update to onHandQty from another device.
 *
 * Observable rule (functional §7 / D-5):
 *   A sync/pull NEVER sets usesRemaining to a positive value and NEVER
 *   reconciles it across devices. It only:
 *     - Forces usesRemaining = 0 when pulled onHandQty = 0 (INV-COH-A).
 *     - Leaves usesRemaining untouched for pulled onHandQty ≥ 1.
 *
 * NOTE: the caller must still apply INV-COH-B (clamp usesRemaining to
 * [0, usesPerContainer]) if the pulled payload also changes usesPerContainer.
 * Call applyUsesPerContainerChange separately for that.
 *
 * containerTransitions is 0 because a pull update is not a local-originating
 * container transition — it's an inbound reconciliation. The SYNCED onHandQty
 * is simply replaced.
 *
 * @param state         Current local DrawState.
 * @param pulledQty     The onHandQty value from the pull payload.
 * @returns             DrawResult.
 */
export function applyPullOnHandQty(state: DrawState, pulledQty: number): DrawResult {
  const onHandQty = Math.max(0, Math.floor(pulledQty));
  // INV-COH-A: if pulled qty is 0, force usesRemaining to 0.
  const usesRemaining = onHandQty === 0 ? 0 : state.usesRemaining;

  return {
    next: { onHandQty, usesRemaining, usesPerContainer: state.usesPerContainer },
    containerTransitions: 0, // pull is not a local transition
    remainderDropped: 0,
  };
}
