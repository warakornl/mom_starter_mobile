/**
 * kickCountLogic.lossGate.b3.test.ts — B3 loss-gate additions (TDD, RED first).
 *
 * Tests for:
 *   1. isLossState() — canonical §1 predicate
 *   2. shouldShowModule() — explicit 'ended' branch (GAP-1)
 *
 * Spec refs:
 *   - docs/specs/mother-room-loss-gates-functional.md §2 Gate 1
 *   - docs/design/mother-room-phase2-rollout.md §4.3 KickCountHomeScreen
 */

import { isLossState, shouldShowModule } from './kickCountLogic';

// ─── isLossState() ─────────────────────────────────────────────────────────────

describe('isLossState() — canonical §1 predicate', () => {
  it('returns true for "ended"', () => {
    expect(isLossState('ended')).toBe(true);
  });

  it('returns false for "pregnant"', () => {
    expect(isLossState('pregnant')).toBe(false);
  });

  it('returns false for "postpartum"', () => {
    expect(isLossState('postpartum')).toBe(false);
  });

  it('returns false for null (GAP-2 fail-safe: unknown state is NOT ended)', () => {
    expect(isLossState(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isLossState(undefined)).toBe(false);
  });
});

// ─── shouldShowModule() — 'ended' explicit branch ─────────────────────────────

describe('shouldShowModule() — explicit ended branch (GAP-1)', () => {
  it('returns true for lifecycle="ended" regardless of gestationalWeek (renders loss layout)', () => {
    // GAP-1: ended MUST deterministically render the module (loss layout branch).
    // The old fallback (gestationalWeek >= 32) was unreliable — an ended profile
    // keeps its last week, which may or may not be >= 32.
    expect(shouldShowModule(0, 'ended')).toBe(true);
    expect(shouldShowModule(15, 'ended')).toBe(true);
    expect(shouldShowModule(32, 'ended')).toBe(true);
    expect(shouldShowModule(40, 'ended')).toBe(true);
  });

  it('FAIL-ON-REVERT: removing "ended" branch makes shouldShowModule(0, "ended") false', () => {
    // Without the explicit branch, wk=0 & ended → shouldShowModule returns false
    // (the old fallback: 0 >= 32 = false). This test STAYS GREEN when the branch exists
    // and GOES RED if the branch is removed — proving fail-on-revert.
    expect(shouldShowModule(0, 'ended')).toBe(true); // only passes with the explicit branch
  });

  it('still returns true for postpartum (SC-K6b: read-only history visible)', () => {
    expect(shouldShowModule(0, 'postpartum')).toBe(true);
    expect(shouldShowModule(28, 'postpartum')).toBe(true);
  });

  it('returns false for pregnant at wk < 32 (D6/SC-K6a)', () => {
    expect(shouldShowModule(0, 'pregnant')).toBe(false);
    expect(shouldShowModule(31, 'pregnant')).toBe(false);
  });

  it('returns true for pregnant at wk >= 32 (full access)', () => {
    expect(shouldShowModule(32, 'pregnant')).toBe(true);
    expect(shouldShowModule(38, 'pregnant')).toBe(true);
  });
});
