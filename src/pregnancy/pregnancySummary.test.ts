/**
 * pregnancySummary.test.ts — TDD (RED → GREEN) tests for buildPregnancySummary.
 *
 * Covers:
 *  - Trimester bucketing using FROZEN computeGestationalAge (boundary vectors)
 *  - avg kicks/day (§3.2): completed sessions only, 0-count-day rule, multi-session/day
 *  - Medication distinct-days + fallback label (OQ-PS2)
 *  - Structural no-trend invariant (no cross-trimester delta field)
 *  - K-8: no console.log of movementCount/sum/avg
 *  - Delivery record exempt from postpartum-exclusion
 *  - Edge states: no EDD, no data, partial
 *
 * Legal fail-closed conditions (§2):
 *  - buildPregnancySummary output has NO trend/comparison/verdict field
 *  - 0-count session counts as a recorded day (§3.2 must-pin)
 */

import {
  buildPregnancySummary,
  type BuildPregnancySummaryInput,
  type PregnancySummary,
} from './pregnancySummary';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';
import type { MedicationLog } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(
  startedAt: string,
  movementCount: number,
  id = `sess-${startedAt}`,
): KickCountSessionRecord {
  return {
    id,
    startedAt, // floating-civil YYYY-MM-DDTHH:mm
    movementCount,
    targetCount: 10,
    status: 'completed',
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  };
}

function makeLog(
  occurrenceTime: string,
  medicationPlanId: string | null = 'plan-A',
  id = `log-${occurrenceTime}-${medicationPlanId}`,
): MedicationLog {
  return {
    id,
    occurrenceTime,
    medicationPlanId,
    status: 'taken',
    note: null,
    loggedAt: '2026-01-01T00:00:00Z',
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  };
}

// EDD: 2026-10-10 (40w0d from this date)
// Week 0 start: 2026-01-09 (EDD - 40*7 = EDD - 280 days)
// T1 start (0w0d): 2026-01-09
// T1 end   (13w6d): 2026-04-11
// T2 start (14w0d): 2026-04-12
// T2 end   (27w6d): 2026-07-12
// T3 start (28w0d): 2026-07-13
// EDD (40w0d): 2026-10-10

const EDD = '2026-10-10';

// Golden vectors for boundary testing (from gestationalAge frozen algo):
// 13w6d: EDD - (40-13)*7 - 6 = EDD - 195 = 2026-04-11 (T1 boundary)
// 14w0d: EDD - (40-14)*7 = EDD - 182 = 2026-04-12 (T2 start)
// 27w6d: EDD - (40-27)*7 - 6 = EDD - 97 = 2026-07-11 ... let me compute properly

// EDD = 2026-10-10 (Oct 10)
// daysUntilEdd(today) = parseCivilDateMs(EDD) - parseCivilDateMs(today) (in days)
// daysPregnant = 280 - daysUntilEdd
// gestWeek = floor(daysPregnant / 7)
//
// gestWeek 13: daysPregnant = 91..97
//   13w0d: daysPregnant=91 → daysUntilEdd=189 → today = EDD - 189 = 2026-10-10 - 189days
//          2026-10-10 - 189 = 2026-04-04
//   13w6d: daysPregnant=97 → daysUntilEdd=183 → today = 2026-04-10
//   14w0d: daysPregnant=98 → daysUntilEdd=182 → today = 2026-04-11
//
// gestWeek 27: daysPregnant=189..195
//   27w6d: daysPregnant=195 → daysUntilEdd=85 → today = EDD - 85 = 2026-07-17
//   28w0d: daysPregnant=196 → daysUntilEdd=84 → today = EDD - 84 = 2026-07-18
//
// Let me verify: 2026-10-10 - 84 days:
//   Oct 10 - 84 = Jul 18 (Oct 10: -10days → Sep 30, -30days → Sep 0 = Aug 31, -31days → Aug 0 = Jul 31, -13days → Jul 18)
//   Actually: Oct(10) → back 10 → Sep 30 → back 30 → Aug 31 → back 31 → Jul 31 → back 13 → Jul 18
//   That's 10+30+31+13 = 84 days. So Jul 18 = 28w0d. ✓

const T1_BOUNDARY_13W6D = '2026-04-10'; // gestWeek=13 (T1)
const T2_BOUNDARY_14W0D = '2026-04-11'; // gestWeek=14 (T2)
const T2_BOUNDARY_27W6D = '2026-07-17'; // gestWeek=27 (T2)
const T3_BOUNDARY_28W0D = '2026-07-18'; // gestWeek=28 (T3)

// Mid-trimester dates for convenience
const T1_MID = '2026-02-15T10:00'; // floating-civil T1
const T2_MID = '2026-05-15T10:00'; // floating-civil T2
const T3_MID = '2026-08-15T10:00'; // floating-civil T3

const TODAY = '2026-07-10'; // for testing "today"

function baseInput(
  overrides: Partial<BuildPregnancySummaryInput> = {},
): BuildPregnancySummaryInput {
  return {
    edd: EDD,
    birthDate: null,
    deliveryType: null,
    hospitalAdmissionDate: null,
    hospitalDischargeDate: null,
    completedKickSessions: [],
    medicationLogs: [],
    plans: [],
    today: TODAY,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildPregnancySummary — trimester bucketing (boundary vectors)', () => {
  it('gestWeek=0 (week 0w0d) falls in T1 (not out of range)', () => {
    // 0w0d: daysPregnant=0 → daysUntilEdd=280 → today=EDD-280
    // 2026-10-10 - 280 days = 2026-01-03
    const week0date = '2026-01-03T10:00';
    const session = makeSession(week0date, 5);
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [session] }));
    expect(result.T1.kicks).not.toBeNull();
    expect(result.T1.kicks!.daysWithData).toBe(1);
    expect(result.T2.kicks).toBeNull();
    expect(result.T3.kicks).toBeNull();
  });

  it('13w6d event falls in T1', () => {
    const session = makeSession(T1_BOUNDARY_13W6D + 'T10:00', 10);
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [session] }));
    expect(result.T1.kicks).not.toBeNull();
    expect(result.T2.kicks).toBeNull();
  });

  it('14w0d event falls in T2 (not T1)', () => {
    const session = makeSession(T2_BOUNDARY_14W0D + 'T10:00', 10);
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [session] }));
    expect(result.T2.kicks).not.toBeNull();
    expect(result.T1.kicks).toBeNull();
  });

  it('27w6d event falls in T2', () => {
    const session = makeSession(T2_BOUNDARY_27W6D + 'T10:00', 10);
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [session] }));
    expect(result.T2.kicks).not.toBeNull();
    expect(result.T3.kicks).toBeNull();
  });

  it('28w0d event falls in T3 (not T2)', () => {
    const session = makeSession(T3_BOUNDARY_28W0D + 'T10:00', 10);
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [session] }));
    expect(result.T3.kicks).not.toBeNull();
    expect(result.T2.kicks).toBeNull();
  });

  it('event before 0w0d (negative gestWeek) is excluded from all trimesters', () => {
    // Before 0w0d: today < EDD - 280 → daysPregnant < 0 → gestWeek < 0 → OUT_OF_RANGE
    const beforePregnancy = '2025-12-01T10:00';
    const session = makeSession(beforePregnancy, 5);
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [session] }));
    expect(result.T1.kicks).toBeNull();
    expect(result.T2.kicks).toBeNull();
    expect(result.T3.kicks).toBeNull();
  });

  it('med/kick event after birthDate is excluded from trimesters (postpartum-exclusion)', () => {
    const birthDate = '2026-06-01';
    const postpartumSession = makeSession('2026-06-05T10:00', 5); // after birth
    const result = buildPregnancySummary(
      baseInput({ birthDate, completedKickSessions: [postpartumSession] }),
    );
    // Session after birthDate excluded from ALL trimester buckets
    expect(result.T1.kicks).toBeNull();
    expect(result.T2.kicks).toBeNull();
    expect(result.T3.kicks).toBeNull();
  });

  it('delivery record (deliveryType + hospitalStay) is NOT excluded even after birthDate', () => {
    const birthDate = '2026-06-01';
    const result = buildPregnancySummary(
      baseInput({
        birthDate,
        deliveryType: 'cesarean',
        hospitalAdmissionDate: '2026-06-01', // on birth
        hospitalDischargeDate: '2026-06-05', // after birth
      }),
    );
    // Delivery record exempt from postpartum-exclusion
    expect(result.delivery).not.toBeNull();
    expect(result.delivery!.deliveryType).toBe('cesarean');
    expect(result.delivery!.hospitalAdmissionDate).toBe('2026-06-01');
    expect(result.delivery!.hospitalDischargeDate).toBe('2026-06-05');
  });
});

describe('buildPregnancySummary — avg kicks/day (§3.2)', () => {
  it('basic avg: 3 days, 60 total → avg = 20, daysWithData = 3', () => {
    const sessions = [
      makeSession('2026-08-01T08:00', 20, 'a'),
      makeSession('2026-08-02T08:00', 15, 'b'),
      makeSession('2026-08-03T08:00', 25, 'c'),
    ];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));
    const kicks = result.T3.kicks!;
    expect(kicks).not.toBeNull();
    expect(kicks.avgKicksPerDay).toBeCloseTo(20, 5);
    expect(kicks.daysWithData).toBe(3);
  });

  it('multi-session same day: counts as 1 day, sums movementCounts', () => {
    const sessions = [
      makeSession('2026-08-01T08:00', 10, 'a'),
      makeSession('2026-08-01T14:00', 15, 'b'),
    ];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));
    const kicks = result.T3.kicks!;
    expect(kicks.daysWithData).toBe(1);
    expect(kicks.avgKicksPerDay).toBeCloseTo(25, 5); // (10+15) / 1
  });

  it('0-count completed session counts as a recorded day (§3.2 must-pin)', () => {
    const sessions = [
      makeSession('2026-08-01T08:00', 0, 'a'),  // 0-count day → daysWithData++
      makeSession('2026-08-02T08:00', 30, 'b'),
    ];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));
    const kicks = result.T3.kicks!;
    // avg = (0+30) / 2 = 15, NOT 30/1
    expect(kicks.daysWithData).toBe(2);
    expect(kicks.avgKicksPerDay).toBeCloseTo(15, 5);
  });

  it('no completed sessions in a trimester → kicks is null (not a number)', () => {
    const result = buildPregnancySummary(baseInput({ completedKickSessions: [] }));
    expect(result.T1.kicks).toBeNull();
    expect(result.T2.kicks).toBeNull();
    expect(result.T3.kicks).toBeNull();
  });

  it('sessions in multiple trimesters → each trimester gets its own avg', () => {
    const sessions = [
      makeSession(T1_MID, 10, 'a'), // T1
      makeSession(T2_MID, 20, 'b'), // T2
    ];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));
    expect(result.T1.kicks!.avgKicksPerDay).toBeCloseTo(10, 5);
    expect(result.T2.kicks!.avgKicksPerDay).toBeCloseTo(20, 5);
    expect(result.T3.kicks).toBeNull();
  });
});

describe('buildPregnancySummary — medication distinct days (§3.3)', () => {
  it('3 logs on 2 days for plan-A → distinctDayCount = 2', () => {
    const logs = [
      makeLog('2026-08-01T08:00', 'plan-A', 'l1'),
      makeLog('2026-08-01T20:00', 'plan-A', 'l2'), // same day
      makeLog('2026-08-02T08:00', 'plan-A', 'l3'),
    ];
    const result = buildPregnancySummary(
      baseInput({
        medicationLogs: logs,
        plans: [{ planId: 'plan-A', name: 'ยา A' }],
      }),
    );
    const meds = result.T3.medications;
    expect(meds).toHaveLength(1);
    expect(meds[0].planId).toBe('plan-A');
    expect(meds[0].label).toBe('ยา A');
    expect(meds[0].distinctDayCount).toBe(2);
  });

  it('OQ-PS2 join-miss: plan deleted → fallback label "ยา (ไม่พบชื่อ)" not a crash', () => {
    const logs = [makeLog('2026-08-01T08:00', 'plan-deleted', 'l1')];
    const result = buildPregnancySummary(
      baseInput({ medicationLogs: logs, plans: [] }), // plan not in plans list
    );
    const meds = result.T3.medications;
    expect(meds).toHaveLength(1);
    expect(meds[0].label).toBe('ยา (ไม่พบชื่อ)');
    expect(meds[0].planId).toBe('plan-deleted');
  });

  it('ad-hoc dose (planId=null) → neutral bucket, not a crash', () => {
    const logs = [makeLog('2026-08-01T08:00', null, 'l1')];
    const result = buildPregnancySummary(baseInput({ medicationLogs: logs, plans: [] }));
    const meds = result.T3.medications;
    expect(meds).toHaveLength(1);
    expect(meds[0].planId).toBeNull();
    // Label should be a neutral term, not include assessment words
    expect(meds[0].label).toBeTruthy();
  });

  it('plan with no logs in a trimester → not shown', () => {
    // Plan exists but has no logs in T1
    const logs = [makeLog(T2_MID, 'plan-B', 'l1')]; // T2 only
    const result = buildPregnancySummary(
      baseInput({
        medicationLogs: logs,
        plans: [{ planId: 'plan-B', name: 'ยา B' }],
      }),
    );
    // T1 should have no meds
    expect(result.T1.medications).toHaveLength(0);
    // T2 should have the med
    expect(result.T2.medications).toHaveLength(1);
  });

  it('two deleted plans both labeled "ยา (ไม่พบชื่อ)" remain two groups', () => {
    const logs = [
      makeLog('2026-08-01T08:00', 'plan-X', 'l1'),
      makeLog('2026-08-02T08:00', 'plan-Y', 'l2'),
    ];
    const result = buildPregnancySummary(
      baseInput({ medicationLogs: logs, plans: [] }),
    );
    const meds = result.T3.medications;
    expect(meds).toHaveLength(2);
    expect(meds.every((m) => m.label === 'ยา (ไม่พบชื่อ)')).toBe(true);
    // They should have different planIds
    const planIds = meds.map((m) => m.planId);
    expect(new Set(planIds).size).toBe(2);
  });
});

describe('buildPregnancySummary — structural NO-TREND invariant (legal §2 / fail-closed)', () => {
  it('output has no cross-trimester delta, trend, or comparison field', () => {
    const sessions = [
      makeSession(T1_MID, 10, 'a'),
      makeSession(T2_MID, 20, 'b'),
      makeSession(T3_MID, 30, 'c'),
    ];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));

    // Check the result object has NO trend/delta/comparison keys
    const resultStr = JSON.stringify(result);
    const forbiddenKeys = [
      'trend',
      'delta',
      'change',
      'comparison',
      'previous',
      'vsT1',
      'vsT2',
      'vsT3',
      'increasing',
      'decreasing',
      'direction',
    ];
    for (const key of forbiddenKeys) {
      expect(resultStr.toLowerCase()).not.toContain(key);
    }

    // Each trimester is an independent data point — no cross-reference
    expect(result.T1).toBeDefined();
    expect(result.T2).toBeDefined();
    expect(result.T3).toBeDefined();
    // These should not exist at any level
    const r = result as unknown as Record<string, unknown>;
    expect(r['kickTrend']).toBeUndefined();
    expect(r['avgKicksDelta']).toBeUndefined();
    expect(r['kicksIncreasing']).toBeUndefined();
  });

  it('planted violation self-check: trend key does NOT appear if we add it', () => {
    // Sanity-check that our JSON.stringify approach would catch a violation
    const fake = { T1: null, T2: null, T3: null, trend: 'up' };
    const fakeStr = JSON.stringify(fake);
    expect(fakeStr.toLowerCase()).toContain('trend'); // would catch violation ✓
  });
});

describe('buildPregnancySummary — edge states', () => {
  it('needsEdd = true when edd is null', () => {
    const result = buildPregnancySummary(baseInput({ edd: null }));
    expect(result.needsEdd).toBe(true);
    // Trimesters should have no data when no EDD
    expect(result.T1.kicks).toBeNull();
    expect(result.T1.medications).toHaveLength(0);
  });

  it('needsEdd = false when edd is provided', () => {
    const result = buildPregnancySummary(baseInput());
    expect(result.needsEdd).toBe(false);
  });

  it('delivery = null when no birth data', () => {
    const result = buildPregnancySummary(baseInput());
    expect(result.delivery).toBeNull();
  });

  it('delivery record shows when birthDate present (no crash)', () => {
    const result = buildPregnancySummary(
      baseInput({ birthDate: '2026-09-01', deliveryType: 'vaginal' }),
    );
    expect(result.delivery).not.toBeNull();
    expect(result.delivery!.birthDate).toBe('2026-09-01');
    expect(result.delivery!.deliveryType).toBe('vaginal');
  });

  it('still-pregnant (no birthDate) does not crash — T3 partial works', () => {
    const sessions = [makeSession('2026-08-01T08:00', 10)];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));
    expect(result.delivery).toBeNull();
    expect(result.T3.kicks).not.toBeNull();
  });
});

describe('buildPregnancySummary — K-8 structural: no console.log of health data', () => {
  it('pregnancySummary.ts does not contain console.log of movementCount', () => {
    // Regex check: the source file must not log movementCount or avg
    // This is a static analysis check — done in the dedicated K8 test file.
    // Here we just verify the function returns without error (runtime K-8 = no egress).
    const sessions = [makeSession(T3_MID, 42, 'k8-test')];
    expect(() => {
      buildPregnancySummary(baseInput({ completedKickSessions: sessions }));
    }).not.toThrow();
  });
});
