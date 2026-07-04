/**
 * medicationAdherence.test.ts — TDD for the on-device adherence computation.
 *
 * Tests `computeAdherence(plans, logs, dateFrom, dateTo)` per RULING 7.2 /
 * medication-behavior.md §A.5.
 *
 * Key invariants under test:
 *   M  = distinct civil days in [dateFrom,dateTo] that the FLAG-4 scheduleRule fires,
 *        clamped to [startAt.date, until]. Derived via the shared recurrenceExpander.
 *   N  = distinct civil days in range with ≥1 taken medicationLog for that plan.
 *   PRN (null scheduleRule) → M=0, N = count of taken log entries in range.
 *   Deleted plan (deletedAt set) → removed from scored set; logs become self-recorded.
 *   active=false has NO effect on M or N.
 *   missed logs never count toward N.
 *   Ad-hoc logs (null medicationPlanId) → selfRecordedLogs, not any plan's adherence.
 *
 * AC-20 / INV-M1: no grading, no colour, no threshold (enforced at render layer).
 * Security: no health data logged here (pure computation, no I/O).
 */

import {
  computeAdherence,
  type ReportMedicationPlan,
  type ReportMedicationLog,
} from './medicationAdherence';

// ─── Date range for all tests ────────────────────────────────────────────────

const dateFrom = '2026-07-01';
const dateTo   = '2026-07-31';

// ─── Plan fixtures ────────────────────────────────────────────────────────────

/** Daily plan that fires every day in July (startAt before range start). */
const dailyPlan: ReportMedicationPlan = {
  id: 'plan-daily',
  name: 'Folic Acid',
  dose: '400 mcg',
  scheduleRule: {
    freq: 'daily',
    startAt: '2026-06-01T08:00',  // anchor before range — fires from Jul 1
    timesOfDay: ['08:00'],
  },
  active: true,
  deletedAt: null,
};

/** Daily plan whose startAt is mid-range (July 15) — tests anchor clamp. */
const midRangePlan: ReportMedicationPlan = {
  id: 'plan-mid',
  name: 'Iron Supplement',
  dose: '200 mg',
  scheduleRule: {
    freq: 'daily',
    startAt: '2026-07-15T09:00',  // anchor mid-range — M should be 17 (Jul 15-31)
    timesOfDay: ['09:00'],
  },
  active: true,
  deletedAt: null,
};

/** Daily plan with an until date mid-range (July 10) — tests until clamp. */
const untilClampPlan: ReportMedicationPlan = {
  id: 'plan-until',
  name: 'Calcium',
  dose: '500 mg',
  scheduleRule: {
    freq: 'daily',
    startAt: '2026-06-01T07:00',
    timesOfDay: ['07:00'],
    until: '2026-07-10',  // fires only through Jul 10 — M = 10
  },
  active: true,
  deletedAt: null,
};

/** Every-3-days plan (freq=every_n_days, interval=3). */
const everyNPlan: ReportMedicationPlan = {
  id: 'plan-n',
  name: 'Vitamin D',
  dose: '1000 IU',
  scheduleRule: {
    freq: 'every_n_days',
    startAt: '2026-07-01T08:00',
    timesOfDay: ['08:00'],
    interval: 3,  // fires Jul 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31 = 11 days
  },
  active: true,
  deletedAt: null,
};

/** PRN plan (null scheduleRule) — M=0, N = count of taken logs. */
const prnPlan: ReportMedicationPlan = {
  id: 'plan-prn',
  name: 'Paracetamol',
  dose: '500 mg',
  scheduleRule: null,
  active: true,
  deletedAt: null,
};

/** Deactivated (active=false) plan — should NOT affect M or N. */
const inactivePlan: ReportMedicationPlan = {
  id: 'plan-inactive',
  name: 'Old Vitamin',
  dose: null,
  scheduleRule: {
    freq: 'daily',
    startAt: '2026-06-01T08:00',
    timesOfDay: ['08:00'],
  },
  active: false,   // deactivated — but adherence count unchanged per §A.5
  deletedAt: null,
};

/** Deleted (tombstoned) plan — excluded from scored set; logs → self-recorded. */
const deletedPlan: ReportMedicationPlan = {
  id: 'plan-del',
  name: 'Old Drug',
  dose: null,
  scheduleRule: {
    freq: 'daily',
    startAt: '2026-06-01T08:00',
    timesOfDay: ['08:00'],
  },
  active: true,
  deletedAt: '2026-07-10T12:00:00Z',  // tombstoned
};

// ─── Log fixtures ─────────────────────────────────────────────────────────────

function makeLog(
  id: string,
  planId: string | null,
  occurrenceTime: string,
  status: 'taken' | 'missed',
  note?: string,
): ReportMedicationLog {
  return { id, medicationPlanId: planId, occurrenceTime, status, note: note ?? null };
}

// Logs for dailyPlan (plan-daily): 3 taken days in range (Jul 1, 2, 3)
const takenLog1 = makeLog('log-1', 'plan-daily', '2026-07-01T08:00', 'taken');
const takenLog2 = makeLog('log-2', 'plan-daily', '2026-07-02T08:00', 'taken');
const takenLog3 = makeLog('log-3', 'plan-daily', '2026-07-03T08:00', 'taken');

// Missed log for dailyPlan on Jul 4 (must NOT count toward N)
const missedLog = makeLog('log-m', 'plan-daily', '2026-07-04T08:00', 'missed');

// Duplicate taken log on same day as takenLog1 (Jul 1) — still counts as 1 distinct day
const dupLog = makeLog('log-dup', 'plan-daily', '2026-07-01T14:00', 'taken');

// Log outside date range (before Jul 1) — must be excluded
const outOfRangeLog = makeLog('log-oor', 'plan-daily', '2026-06-30T08:00', 'taken');

// PRN taken logs (no plan ID → ad-hoc, or for plan-prn with plan ID)
const prnTaken1 = makeLog('prn-1', 'plan-prn', '2026-07-05T10:00', 'taken');
const prnTaken2 = makeLog('prn-2', 'plan-prn', '2026-07-10T10:00', 'taken');
const prnMissed = makeLog('prn-m', 'plan-prn', '2026-07-12T10:00', 'missed');

// Ad-hoc log (null medicationPlanId) → must appear in selfRecordedLogs
const adHocLog = makeLog('adhoc-1', null, '2026-07-08T10:00', 'taken');
const adHocMissed = makeLog('adhoc-m', null, '2026-07-09T10:00', 'missed');

// Log for deleted plan (plan-del) → must appear in selfRecordedLogs
const deletedPlanLog = makeLog('del-log-1', 'plan-del', '2026-07-05T08:00', 'taken');

// Log with a note for note-gating test
const noteLog = makeLog('note-log', 'plan-daily', '2026-07-05T08:00', 'taken', 'My note');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeAdherence', () => {

  // ── Scheduled plan — M computation ──────────────────────────────────────────

  it('computes M = 31 for a daily plan that covers the entire July range', () => {
    const { planAdherences } = computeAdherence(
      [dailyPlan],
      [],
      dateFrom, dateTo,
    );
    expect(planAdherences).toHaveLength(1);
    expect(planAdherences[0].M).toBe(31);
    expect(planAdherences[0].isPrn).toBe(false);
  });

  it('computes M correctly for N/M count with taken logs', () => {
    const { planAdherences } = computeAdherence(
      [dailyPlan],
      [takenLog1, takenLog2, takenLog3],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].M).toBe(31);
    expect(planAdherences[0].N).toBe(3);
  });

  it('clamps M to [startAt.date, dateTo] when startAt is mid-range', () => {
    // startAt = 2026-07-15 → schedule fires Jul 15-31 = 17 days
    const { planAdherences } = computeAdherence(
      [midRangePlan],
      [],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].M).toBe(17);
    expect(planAdherences[0].N).toBe(0);
  });

  it('clamps M to [dateFrom, until] when until is mid-range', () => {
    // until = 2026-07-10, dateFrom = 2026-07-01 → M = 10
    const { planAdherences } = computeAdherence(
      [untilClampPlan],
      [],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].M).toBe(10);
  });

  it('computes M correctly for every_n_days plan (interval=3 → 11 days in July)', () => {
    // Jul 1,4,7,10,13,16,19,22,25,28,31 = 11 fire-days
    const { planAdherences } = computeAdherence(
      [everyNPlan],
      [],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].M).toBe(11);
  });

  // ── N computation ───────────────────────────────────────────────────────────

  it('N counts distinct taken days only (not log entries)', () => {
    // dupLog is a second taken on the same day (Jul 1) as takenLog1
    const { planAdherences } = computeAdherence(
      [dailyPlan],
      [takenLog1, dupLog],  // both on Jul 1
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(1);  // counted once
  });

  it('missed logs do NOT count toward N', () => {
    const { planAdherences } = computeAdherence(
      [dailyPlan],
      [takenLog1, missedLog],  // Jul 1 taken, Jul 4 missed
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(1);  // only Jul 1
  });

  it('N counts only M-days (a taken log on a non-fire day does not increment N)', () => {
    // everyNPlan fires Jul 1, 4, 7, … A taken log on Jul 2 (non-fire day) must not count.
    const logOnFireDay    = makeLog('ev-1', 'plan-n', '2026-07-01T08:00', 'taken');
    const logOnNonFireDay = makeLog('ev-2', 'plan-n', '2026-07-02T08:00', 'taken');
    const { planAdherences } = computeAdherence(
      [everyNPlan],
      [logOnFireDay, logOnNonFireDay],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(1);  // only Jul 1 fire-day
  });

  it('out-of-range logs are excluded from N', () => {
    const { planAdherences } = computeAdherence(
      [dailyPlan],
      [outOfRangeLog],  // Jun 30 — before dateFrom
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(0);
  });

  // ── PRN plan (null scheduleRule) ─────────────────────────────────────────────

  it('PRN plan has isPrn=true and M=0', () => {
    const { planAdherences } = computeAdherence(
      [prnPlan],
      [],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].isPrn).toBe(true);
    expect(planAdherences[0].M).toBe(0);
  });

  it('PRN plan: N = count of taken log entries (not distinct days)', () => {
    // Two taken logs on same day for PRN → N = 2 (count, not distinct days)
    const prn1 = makeLog('p1', 'plan-prn', '2026-07-05T10:00', 'taken');
    const prn2 = makeLog('p2', 'plan-prn', '2026-07-05T14:00', 'taken');  // same day
    const { planAdherences } = computeAdherence(
      [prnPlan],
      [prn1, prn2],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(2);  // count of log entries
  });

  it('PRN plan: missed logs do NOT count toward N', () => {
    const { planAdherences } = computeAdherence(
      [prnPlan],
      [prnTaken1, prnTaken2, prnMissed],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(2);  // only taken
  });

  // ── active=false has no effect ──────────────────────────────────────────────

  it('active=false does NOT remove plan from scored set or change M', () => {
    const inactiveTaken = makeLog('ia-1', 'plan-inactive', '2026-07-01T08:00', 'taken');
    const { planAdherences } = computeAdherence(
      [inactivePlan],
      [inactiveTaken],
      dateFrom, dateTo,
    );
    // inactive plan still appears in scored set with M=31, N=1
    expect(planAdherences).toHaveLength(1);
    expect(planAdherences[0].M).toBe(31);
    expect(planAdherences[0].N).toBe(1);
  });

  // ── Deleted plan ─────────────────────────────────────────────────────────────

  it('deleted plan is excluded from planAdherences', () => {
    const { planAdherences } = computeAdherence(
      [deletedPlan],
      [deletedPlanLog],
      dateFrom, dateTo,
    );
    expect(planAdherences).toHaveLength(0);
  });

  it('logs for a deleted plan appear in selfRecordedLogs', () => {
    const { selfRecordedLogs } = computeAdherence(
      [deletedPlan],
      [deletedPlanLog],
      dateFrom, dateTo,
    );
    expect(selfRecordedLogs).toHaveLength(1);
    expect(selfRecordedLogs[0].id).toBe('del-log-1');
  });

  it('deleted plan logs are NOT counted in any plan N', () => {
    // dailyPlan is live, deletedPlan is deleted
    // deletedPlanLog references plan-del → must not inflate dailyPlan N
    const { planAdherences } = computeAdherence(
      [dailyPlan, deletedPlan],
      [takenLog1, deletedPlanLog],
      dateFrom, dateTo,
    );
    const daily = planAdherences.find(p => p.planId === 'plan-daily')!;
    expect(daily.N).toBe(1);  // only takenLog1
  });

  // ── Ad-hoc logs (null medicationPlanId) ────────────────────────────────────

  it('ad-hoc logs appear in selfRecordedLogs, not in any plan adherence', () => {
    const { planAdherences, selfRecordedLogs } = computeAdherence(
      [dailyPlan],
      [takenLog1, adHocLog],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].N).toBe(1);   // only takenLog1 for dailyPlan
    expect(selfRecordedLogs).toHaveLength(1);
    expect(selfRecordedLogs[0].id).toBe('adhoc-1');
  });

  it('ad-hoc missed logs also appear in selfRecordedLogs', () => {
    const { selfRecordedLogs } = computeAdherence(
      [],
      [adHocLog, adHocMissed],
      dateFrom, dateTo,
    );
    expect(selfRecordedLogs).toHaveLength(2);
  });

  it('ad-hoc logs outside range are excluded from selfRecordedLogs', () => {
    const outOfRange = makeLog('adhoc-oor', null, '2026-06-30T10:00', 'taken');
    const { selfRecordedLogs } = computeAdherence(
      [],
      [outOfRange],
      dateFrom, dateTo,
    );
    expect(selfRecordedLogs).toHaveLength(0);
  });

  // ── Plan name and dose ────────────────────────────────────────────────────────

  it('returns plan name and dose in planAdherence result', () => {
    const { planAdherences } = computeAdherence(
      [dailyPlan],
      [],
      dateFrom, dateTo,
    );
    expect(planAdherences[0].name).toBe('Folic Acid');
    expect(planAdherences[0].dose).toBe('400 mcg');
  });

  it('dose is null when plan has no dose', () => {
    const noDose: ReportMedicationPlan = { ...inactivePlan, dose: null };
    const { planAdherences } = computeAdherence([noDose], [], dateFrom, dateTo);
    expect(planAdherences[0].dose).toBeNull();
  });

  // ── Multiple plans ────────────────────────────────────────────────────────────

  it('handles multiple live plans independently', () => {
    const daily1 = makeLog('d1', 'plan-daily', '2026-07-01T08:00', 'taken');
    const daily2 = makeLog('d2', 'plan-daily', '2026-07-02T08:00', 'taken');
    const prn1   = makeLog('p1', 'plan-prn', '2026-07-05T10:00', 'taken');

    const { planAdherences, selfRecordedLogs } = computeAdherence(
      [dailyPlan, prnPlan],
      [daily1, daily2, prn1, adHocLog],
      dateFrom, dateTo,
    );

    expect(planAdherences).toHaveLength(2);
    const daily = planAdherences.find(p => p.planId === 'plan-daily')!;
    const prn   = planAdherences.find(p => p.planId === 'plan-prn')!;
    expect(daily.M).toBe(31);
    expect(daily.N).toBe(2);
    expect(prn.isPrn).toBe(true);
    expect(prn.N).toBe(1);
    expect(selfRecordedLogs).toHaveLength(1);  // adHocLog
  });

  // ── Empty inputs ──────────────────────────────────────────────────────────────

  it('returns empty results for no plans and no logs', () => {
    const result = computeAdherence([], [], dateFrom, dateTo);
    expect(result.planAdherences).toHaveLength(0);
    expect(result.selfRecordedLogs).toHaveLength(0);
  });

  it('handles only deleted plans (no live plans) gracefully', () => {
    const result = computeAdherence([deletedPlan], [deletedPlanLog], dateFrom, dateTo);
    expect(result.planAdherences).toHaveLength(0);
    expect(result.selfRecordedLogs).toHaveLength(1);
  });
});
