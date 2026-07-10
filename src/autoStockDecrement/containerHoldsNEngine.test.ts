/**
 * containerHoldsNEngine.test.ts — TDD RED → GREEN for the container-holds-N
 * sub-unit draw algorithm + deterministic checks A–E.
 *
 * Source of truth: auto-stock-decrement-functional.md §5 (algorithm §5.2,
 * invariants §5.1, edge behaviors §5.3, checks A–E §5.4).
 *
 * All fixtures use P = 26 uses per container (as per spec §5.4).
 *
 * Invariants asserted:
 *   INV-COH-A  onHandQty = 0 ⇒ usesRemaining = 0
 *   INV-COH-B  0 ≤ usesRemaining ≤ usesPerContainer
 *   INV-CLAMP  onHandQty and usesRemaining never negative
 *   INV-ASD-8  Draws within the open container produce ZERO sync push
 *              (only container transitions egress)
 *
 * Security: all UUIDs / values are synthetic test fixtures — no real health data.
 */

import {
  applyDraw,
  type DrawState,
  type DrawResult,
} from './containerHoldsNEngine';

const P = 26; // uses per container (all checks use P=26 per spec §5.4)

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeState(
  onHandQty: number,
  usesRemaining: number,
): DrawState {
  return { onHandQty, usesRemaining, usesPerContainer: P };
}

// ─── Deterministic check A ────────────────────────────────────────────────────
// Setup: onHandQty≥2, usesRemaining=1
// Action: one 1-use draw, then another 1-use draw
// Expected after #1: usesRemaining=0, count unchanged; egress=none
// Expected after #2: count-1, usesRemaining=25; egress=1 container-transition push

describe('Check A — two 1-use draws spanning container boundary', () => {
  it('draw #1: usesRemaining 1→0, count unchanged, NO egress', () => {
    const state = makeState(3, 1);
    const result = applyDraw(state, 1);
    expect(result.next.usesRemaining).toBe(0);
    expect(result.next.onHandQty).toBe(3); // count unchanged
    expect(result.containerTransitions).toBe(0); // no egress
  });

  it('draw #2 (from usesRemaining=0): count-1, usesRemaining=25, 1 container push', () => {
    const state = makeState(3, 0); // state after draw #1
    const result = applyDraw(state, 1);
    expect(result.next.onHandQty).toBe(2); // count-1
    expect(result.next.usesRemaining).toBe(25); // P-1=25
    expect(result.containerTransitions).toBe(1); // 1 egress push
  });
});

// ─── Deterministic check B ────────────────────────────────────────────────────
// Setup: onHandQty≥2, usesRemaining=1
// Action: single 2-use draw
// Expected: count-1, usesRemaining=25; 1 container-transition push

describe('Check B — single 2-use draw spanning container boundary', () => {
  it('count-1, usesRemaining=25, 1 container push', () => {
    const state = makeState(3, 1);
    const result = applyDraw(state, 2);
    expect(result.next.onHandQty).toBe(2);
    expect(result.next.usesRemaining).toBe(25);
    expect(result.containerTransitions).toBe(1);
  });
});

// ─── Deterministic check C ────────────────────────────────────────────────────
// Setup: usesRemaining=10
// Action: set-count 2→3 (onHandQty change via applySetCount)
// Expected: onHandQty=3, usesRemaining=10 (untouched); 1 container-transition push

import { applySetCount } from './containerHoldsNEngine';

describe('Check C — set-count leaves usesRemaining untouched (onHandQty≥1)', () => {
  it('onHandQty=3, usesRemaining=10 (untouched), 1 push', () => {
    const state = makeState(2, 10);
    const result = applySetCount(state, 3);
    expect(result.next.onHandQty).toBe(3);
    expect(result.next.usesRemaining).toBe(10); // untouched
    expect(result.containerTransitions).toBe(1); // the onHandQty change itself is a push
  });
});

// ─── Deterministic check D ────────────────────────────────────────────────────
// Setup: onHandQty=1, usesRemaining=1
// Action: single 2-use draw
// Expected: onHandQty=0, usesRemaining=0; remainder 1 dropped; 1 push

describe('Check D — last container, 2-use draw, remainder dropped (E-1 clamp)', () => {
  it('onHandQty→0, usesRemaining→0, remainder dropped, 1 push', () => {
    const state = makeState(1, 1);
    const result = applyDraw(state, 2);
    expect(result.next.onHandQty).toBe(0);
    expect(result.next.usesRemaining).toBe(0);
    expect(result.containerTransitions).toBe(1);
    expect(result.remainderDropped).toBe(1); // 1 use dropped
  });
});

// ─── Deterministic check E ────────────────────────────────────────────────────
// Setup: usesRemaining=10
// Action: set-count →0 (INV-COH-A: forces usesRemaining=0)
// Expected: onHandQty=0, usesRemaining=0 (forced), 1 push

describe('Check E — set-count →0 forces usesRemaining=0 (INV-COH-A / E-11)', () => {
  it('onHandQty=0, usesRemaining=0 forced, 1 push', () => {
    const state = makeState(2, 10);
    const result = applySetCount(state, 0);
    expect(result.next.onHandQty).toBe(0);
    expect(result.next.usesRemaining).toBe(0); // forced by INV-COH-A
    expect(result.containerTransitions).toBe(1);
  });
});

// ─── INV-COH-A: onHandQty=0 ⇒ usesRemaining=0 (all paths) ──────────────────

describe('INV-COH-A: onHandQty=0 forces usesRemaining=0', () => {
  it('draw that depletes last container forces usesRemaining=0', () => {
    const state = makeState(1, 5);
    const result = applyDraw(state, 10); // more than remaining
    expect(result.next.onHandQty).toBe(0);
    expect(result.next.usesRemaining).toBe(0);
  });

  it('set-count to 0 forces usesRemaining=0', () => {
    const state = makeState(3, 15);
    const result = applySetCount(state, 0);
    expect(result.next.onHandQty).toBe(0);
    expect(result.next.usesRemaining).toBe(0);
  });
});

// ─── INV-COH-B: usesPerContainer change clamps usesRemaining ─────────────────

import { applyUsesPerContainerChange } from './containerHoldsNEngine';

describe('INV-COH-B: usesPerContainer edit clamps usesRemaining to [0, newP]', () => {
  it('P shrinks below current usesRemaining → clamp down', () => {
    const state = { onHandQty: 2, usesRemaining: 25, usesPerContainer: 26 };
    const result = applyUsesPerContainerChange(state, 20); // new P = 20
    expect(result.next.usesRemaining).toBe(20); // clamped
    expect(result.next.usesPerContainer).toBe(20);
  });

  it('P grows → usesRemaining untouched', () => {
    const state = { onHandQty: 2, usesRemaining: 10, usesPerContainer: 26 };
    const result = applyUsesPerContainerChange(state, 30);
    expect(result.next.usesRemaining).toBe(10); // untouched
    expect(result.next.usesPerContainer).toBe(30);
  });
});

// ─── INV-CLAMP: never negative ────────────────────────────────────────────────

describe('INV-CLAMP: no negative values ever', () => {
  it('draw exceeding all containers → clamps at 0, never negative', () => {
    const state = makeState(2, 3); // 2 containers, 3 uses left in open
    // total = 3 + 26 = 29 uses, demand 100
    const result = applyDraw(state, 100);
    expect(result.next.onHandQty).toBeGreaterThanOrEqual(0);
    expect(result.next.usesRemaining).toBeGreaterThanOrEqual(0);
  });

  it('draw of 0 is a no-op — nothing changes, no egress (E-1 / D-2)', () => {
    const state = makeState(3, 10);
    const result = applyDraw(state, 0);
    expect(result.next.onHandQty).toBe(3);
    expect(result.next.usesRemaining).toBe(10);
    expect(result.containerTransitions).toBe(0);
  });
});

// ─── E-8: lazy roll-over ──────────────────────────────────────────────────────
// Reaching usesRemaining=0 does NOT by itself change onHandQty.
// The roll fires on the NEXT scoop-demanding use.

describe('E-8 — lazy roll-over: usesRemaining=0 does not auto-roll', () => {
  it('usesRemaining=0, demand 0 → no roll, count unchanged', () => {
    const state = makeState(3, 0);
    const result = applyDraw(state, 0);
    expect(result.next.onHandQty).toBe(3);
    expect(result.next.usesRemaining).toBe(0);
    expect(result.containerTransitions).toBe(0);
  });

  it('usesRemaining=0, demand 1 → roll fires (count-1, usesRemaining=P-1)', () => {
    const state = makeState(3, 0);
    const result = applyDraw(state, 1);
    expect(result.next.onHandQty).toBe(2); // count-1
    expect(result.next.usesRemaining).toBe(25); // P-1
    expect(result.containerTransitions).toBe(1);
  });
});

// ─── INV-ASD-8: draws within open container produce ZERO egress ───────────────
// N draws that STAY within the open container must have containerTransitions = 0
// across all draws combined (no sync push for sub-container draws).

describe('INV-ASD-8: N feeds within a container → zero container transitions', () => {
  it('10 × 1-use draws, usesRemaining=20 → no container transition', () => {
    let state = makeState(3, 20);
    let totalTransitions = 0;
    for (let i = 0; i < 10; i++) {
      const result = applyDraw(state, 1);
      totalTransitions += result.containerTransitions;
      state = result.next;
    }
    expect(totalTransitions).toBe(0); // zero egress
    expect(state.usesRemaining).toBe(10);
    expect(state.onHandQty).toBe(3); // count unchanged
  });
});

// ─── Cross-device pull: onHandQty=0 forces usesRemaining=0 (D-5 / INV-COH-A)

import { applyPullOnHandQty } from './containerHoldsNEngine';

describe('D-5 cross-device pull: onHandQty=0 pull forces usesRemaining=0', () => {
  it('pulled onHandQty=0 → usesRemaining forced to 0', () => {
    const state = makeState(2, 15);
    const result = applyPullOnHandQty(state, 0);
    expect(result.next.onHandQty).toBe(0);
    expect(result.next.usesRemaining).toBe(0);
  });

  it('pulled onHandQty≥1 → usesRemaining NOT touched by pull', () => {
    const state = makeState(1, 15);
    const result = applyPullOnHandQty(state, 3);
    expect(result.next.onHandQty).toBe(3);
    expect(result.next.usesRemaining).toBe(15); // untouched
  });
});

// ─── Multi-container roll-through ─────────────────────────────────────────────

describe('multi-container roll: large demand spans multiple containers', () => {
  it('demand = 30 from state (onHandQty=3, usesRemaining=2, P=26) → 2 transitions', () => {
    // Available: 2 + 26 = 28 uses across containers 3 and 2. demand=30 > 28.
    // Draw 2 from open → roll to container #2 (count 3→2), draw 26 → empty
    // → roll attempt: count=2 ≥ 2 → roll to container #1 (count 2→1), draw 2 of 30-28=2 → done.
    // Wait, let me re-trace:
    // demand=30, usesRemaining=2, P=26
    // step1: draw=min(30,2)=2; usesRemaining=0; k=28
    // while k>0:
    //   count=3≥2 → count-=1→2; usesRemaining=26; step=min(28,26)=26; usesRemaining=0; k=2
    //   count=2≥2 → count-=1→1; usesRemaining=26; step=min(2,26)=2; usesRemaining=24; k=0
    // result: onHandQty=1, usesRemaining=24, transitions=2
    const state = makeState(3, 2);
    const result = applyDraw(state, 30);
    expect(result.next.onHandQty).toBe(1);
    expect(result.next.usesRemaining).toBe(24);
    expect(result.containerTransitions).toBe(2);
  });
});
