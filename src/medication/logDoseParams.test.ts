/**
 * logDoseParams.test.ts — RED tests for buildLogDoseParams (Slice 2, Task 11)
 *
 * TDD: these tests must fail before the implementation exists.
 *
 * buildLogDoseParams(planId) is the pure helper that turns a MedicationPlan id
 * into the Capture route-param shape `{ medicationPlanId: string }` so the
 * "log a dose" affordance in MedicationPlanListScreen can navigate without
 * knowing the internal Capture param shape.
 *
 * Security: planId is a UUID, not a drug name or dose — safe in route params
 * (PDPA SD-9). No health data flows through this function.
 */

import { buildLogDoseParams } from './logDoseParams';

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
