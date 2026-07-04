/**
 * logDoseParams.test.ts — unit tests for logDoseParams helpers (Slice 2, Task 11)
 *
 * TDD: shouldShowLogDose tests were written RED before the implementation.
 *
 * buildLogDoseParams(planId) turns a MedicationPlan id into the Capture
 * route-param shape `{ medicationPlanId: string }` so the "log a dose"
 * affordance in MedicationPlanListScreen can navigate without knowing the
 * internal Capture param shape.
 *
 * shouldShowLogDose(plan, hasOnLogDose) is the pure visibility predicate:
 * returns true only when the plan is active AND the onLogDose callback is
 * wired (i.e. both conditions must hold).
 *
 * Security: planId is a UUID, not a drug name or dose — safe in route params
 * (PDPA SD-9). No health data flows through these functions.
 */

import { buildLogDoseParams, shouldShowLogDose } from './logDoseParams';

describe('buildLogDoseParams', () => {
  it('returns an object with medicationPlanId equal to the supplied planId', () => {
    const planId = '123e4567-e89b-12d3-a456-426614174000';
    const result = buildLogDoseParams(planId);
    expect(result.medicationPlanId).toBe(planId);
  });

  it('has exactly one key — medicationPlanId', () => {
    const result = buildLogDoseParams('plan-abc');
    expect(Object.keys(result)).toEqual(['medicationPlanId']);
  });

  it('preserves the UUID verbatim (no transformation)', () => {
    const id = 'aaaaaaaa-0000-4000-8000-bbbbbbbbbbbb';
    expect(buildLogDoseParams(id).medicationPlanId).toBe(id);
  });

  it('works for any non-empty string planId', () => {
    expect(buildLogDoseParams('plan-1').medicationPlanId).toBe('plan-1');
    expect(buildLogDoseParams('  ').medicationPlanId).toBe('  ');
  });
});

// ─── shouldShowLogDose ────────────────────────────────────────────────────────
// Pure predicate: plan.active && hasOnLogDose.
// Written RED before the implementation (TDD — a11y blocker fix, Task 11).

describe('shouldShowLogDose', () => {
  // Minimal stub: only the fields shouldShowLogDose inspects.
  const activePlan = { active: true } as { active: boolean };
  const inactivePlan = { active: false } as { active: boolean };

  it('returns true when plan is active and callback is wired', () => {
    expect(shouldShowLogDose(activePlan, true)).toBe(true);
  });

  it('returns false when plan is inactive even if callback is wired', () => {
    expect(shouldShowLogDose(inactivePlan, true)).toBe(false);
  });

  it('returns false when plan is active but callback is absent', () => {
    expect(shouldShowLogDose(activePlan, false)).toBe(false);
  });

  it('returns false when both plan is inactive and callback is absent', () => {
    expect(shouldShowLogDose(inactivePlan, false)).toBe(false);
  });
});
