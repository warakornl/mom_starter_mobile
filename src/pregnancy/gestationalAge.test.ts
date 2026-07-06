/**
 * gestationalAge.test.ts — Golden-vector regression tests.
 *
 * Source of truth: api-contract.md §"Gestational-age & stage computation"
 * and data-model.md §3.1 "Golden test-vectors".
 *
 * These 14 rows are the CANONICAL lockstep guard — if this test file passes
 * AND the Spring Boot backend's equivalent test passes, client and server are
 * guaranteed to agree on gestationalWeek / gestationalDay / progress for all
 * inputs, including the negative-daysPregnant band (EDD beyond normal window).
 *
 * Invariant checked by every row:
 *   gestationalWeek * 7 + gestationalDay === daysPregnant
 * This holds ONLY with floorDiv / floorMod (floor toward −∞), NOT with JS raw
 * `%` on negative operands (which truncates toward 0).
 *
 * Floating-point tolerance: progress values use toBeCloseTo(prog, 10) to avoid
 * IEEE 754 representation noise while still catching integer-division bugs.
 */

import { computeGestationalAge, civilDaysBetween, weekToTargetDate } from './gestationalAge';
import type { GestationalAge } from './gestationalAge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fixed civil "today" used across all golden-vector tests. */
const TODAY = '2026-06-29';

/** Add `n` calendar days to a YYYY-MM-DD civil-date string (uses UTC to avoid DST). */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const result = new Date(base + n * 86_400_000);
  const ry = result.getUTCFullYear();
  const rm = String(result.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(result.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

/**
 * Derive the EDD string for a given target `daysPregnant`:
 *   daysUntilEdd = 280 - daysPregnant
 *   edd = TODAY + daysUntilEdd days
 */
function eddForDaysPregnant(dp: number): string {
  return addDays(TODAY, 280 - dp);
}

// ─── civilDaysBetween ─────────────────────────────────────────────────────────

describe('civilDaysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(civilDaysBetween('2026-06-29', '2026-06-29')).toBe(0);
  });

  it('returns positive for a future date', () => {
    expect(civilDaysBetween('2026-06-29', '2026-07-06')).toBe(7);
  });

  it('returns negative for a past date', () => {
    expect(civilDaysBetween('2026-07-06', '2026-06-29')).toBe(-7);
  });

  it('handles month boundary', () => {
    expect(civilDaysBetween('2026-06-30', '2026-07-01')).toBe(1);
  });

  it('handles year boundary', () => {
    expect(civilDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('handles leap year', () => {
    expect(civilDaysBetween('2028-02-28', '2028-03-01')).toBe(2); // 2028 is leap
  });
});

// ─── Golden test-vectors (canonical — data-model.md §3.1) ────────────────────

/**
 * 14-row canonical table from data-model.md §3.1 "Golden test-vectors".
 *
 * Columns:
 *   dp    — daysPregnant
 *   wk    — gestationalWeek (floor toward −∞; may be negative)
 *   day   — gestationalDay  (Euclidean 0..6)
 *   prog  — progress        (clamp(dp/280, 0, 1); real division)
 *   stage — currentStage    ('T1' | 'T2' | 'T3')
 *   dwa   — deliveryWindowActive (gestationalWeek >= 37)
 *
 * The note column is documentation only.
 */
type GoldenRow = {
  dp: number;
  wk: number;
  day: number;
  prog: number;
  stage: 'T1' | 'T2' | 'T3';
  dwa: boolean;
  note: string;
};

const GOLDEN_VECTORS: GoldenRow[] = [
  // ── Negative band (EDD beyond normal window; daysPregnant < 0) ──────────
  { dp: -28, wk: -4, day: 0, prog: 0.0,       stage: 'T1', dwa: false, note: '-28: wk -4, suppressed' },
  { dp:  -8, wk: -2, day: 6, prog: 0.0,       stage: 'T1', dwa: false, note: '-8: wk -2 day 6 (floor/Euclidean)' },
  { dp:  -1, wk: -1, day: 6, prog: 0.0,       stage: 'T1', dwa: false, note: '-1: wk -1 day 6 (NOT wk 0)' },
  // ── Day 0 / early pregnancy ──────────────────────────────────────────────
  { dp:   0, wk:  0, day: 0, prog: 0.0,       stage: 'T1', dwa: false, note: 'day 0 (daysUntilEdd=280)' },
  { dp:   1, wk:  0, day: 1, prog: 1 / 280,   stage: 'T1', dwa: false, note: 'day 1' },
  { dp:   6, wk:  0, day: 6, prog: 6 / 280,   stage: 'T1', dwa: false, note: 'day 6 of wk 0' },
  { dp:   7, wk:  1, day: 0, prog: 7 / 280,   stage: 'T1', dwa: false, note: 'wk 1 starts' },
  // ── T1/T2 boundary ───────────────────────────────────────────────────────
  { dp:  91, wk: 13, day: 0, prog: 91 / 280,  stage: 'T1', dwa: false, note: 'wk 13 = T1 (not T2)' },
  // ── Mid T2 ───────────────────────────────────────────────────────────────
  { dp: 188, wk: 26, day: 6, prog: 188 / 280, stage: 'T2', dwa: false, note: 'wk 26+6d, T2' },
  // ── T3, pre-EDD ──────────────────────────────────────────────────────────
  { dp: 279, wk: 39, day: 6, prog: 279 / 280, stage: 'T3', dwa: true,  note: 'last day before EDD, dwa=true' },
  // ── EDD exactly ──────────────────────────────────────────────────────────
  { dp: 280, wk: 40, day: 0, prog: 1.0,       stage: 'T3', dwa: true,  note: 'EDD exactly (day 280)' },
  // ── Past EDD (clamped progress) ──────────────────────────────────────────
  { dp: 287, wk: 41, day: 0, prog: 1.0,       stage: 'T3', dwa: true,  note: 'wk 41, past EDD, prog clamped' },
  { dp: 294, wk: 42, day: 0, prog: 1.0,       stage: 'T3', dwa: true,  note: 'wk 42, past EDD' },
  { dp: 308, wk: 44, day: 0, prog: 1.0,       stage: 'T3', dwa: true,  note: 'wk 44, window ceiling' },
];

describe('computeGestationalAge — Golden test-vectors (data-model.md §3.1)', () => {
  test.each(GOLDEN_VECTORS)(
    'daysPregnant=$dp → wk=$wk day=$day stage=$stage dwa=$dwa ($note)',
    ({ dp, wk, day, prog, stage, dwa }: GoldenRow) => {
      const edd = eddForDaysPregnant(dp);
      const result: GestationalAge = computeGestationalAge(edd, TODAY);

      // gestationalWeek — MUST use floor toward −∞ (not truncation toward 0)
      // Critical: daysPregnant=-1 → floor(-1/7)=-1, NOT truncate(-1/7)=0
      expect(result.gestationalWeek).toBe(wk);

      // gestationalDay — MUST use Euclidean modulo ((d%7)+7)%7
      // Critical: daysPregnant=-1 → ((-1%7)+7)%7 = 6, NOT (-1%7)=-1
      expect(result.gestationalDay).toBe(day);

      // Fundamental invariant: week*7 + day === daysPregnant (ALL inputs, incl. negative)
      // This invariant FAILS with raw JS `/` and `%` on negative operands
      expect(result.gestationalWeek * 7 + result.gestationalDay).toBe(dp);

      // progress — real/float division, clamped to [0, 1]
      // Using 10 decimal places to catch integer-division bugs without false negatives
      expect(result.progress).toBeCloseTo(prog, 10);

      // currentStage
      expect(result.currentStage).toBe(stage);

      // deliveryWindowActive
      expect(result.deliveryWindowActive).toBe(dwa);

      // daysPregnant round-trip
      expect(result.daysPregnant).toBe(dp);

      // daysRemaining = 280 - daysPregnant (may be negative past EDD)
      expect(result.daysRemaining).toBe(280 - dp);
    },
  );
});

// ─── Display rules (data-model.md §3.1 / api-contract.md §"Gestational-age") ─

describe('computeGestationalAge — display rules', () => {
  it('displayedWeek = 0 when gestationalWeek < 0 (negative band)', () => {
    // dp=-28 → wk=-4 → displayed=0
    const result = computeGestationalAge(eddForDaysPregnant(-28), TODAY);
    expect(result.displayedWeek).toBe(0);
    expect(result.gestationalWeek).toBe(-4);
  });

  it('suppressDayDisplay = true when gestationalWeek < 0', () => {
    const result = computeGestationalAge(eddForDaysPregnant(-8), TODAY);
    expect(result.suppressDayDisplay).toBe(true);
  });

  it('suppressDayDisplay = false when gestationalWeek >= 0', () => {
    const result = computeGestationalAge(eddForDaysPregnant(0), TODAY);
    expect(result.suppressDayDisplay).toBe(false);
  });

  it('displayedWeek equals gestationalWeek for wk 0', () => {
    const result = computeGestationalAge(eddForDaysPregnant(0), TODAY);
    expect(result.displayedWeek).toBe(0);
  });

  it('upper end NOT clamped: wk 41 displays faithfully (not 40)', () => {
    // dp=287 → wk=41; must render as 41, not clamped to 40
    const result = computeGestationalAge(eddForDaysPregnant(287), TODAY);
    expect(result.displayedWeek).toBe(41);
    expect(result.suppressDayDisplay).toBe(false);
  });

  it('upper end NOT clamped: wk 44 displays faithfully', () => {
    const result = computeGestationalAge(eddForDaysPregnant(308), TODAY);
    expect(result.displayedWeek).toBe(44);
  });

  it('daysRemaining is negative once past EDD', () => {
    // dp=287 → daysUntilEdd = 280-287 = -7
    const result = computeGestationalAge(eddForDaysPregnant(287), TODAY);
    expect(result.daysRemaining).toBe(-7);
  });

  it('T1/T2 edge: wk 13 is T1', () => {
    expect(computeGestationalAge(eddForDaysPregnant(91), TODAY).currentStage).toBe('T1');
  });

  it('T2 starts at wk 14 (dp=98)', () => {
    // dp=98 → gestationalWeek=14
    expect(computeGestationalAge(eddForDaysPregnant(98), TODAY).currentStage).toBe('T2');
  });

  it('T2/T3 edge: wk 27 is T2 (dp=189)', () => {
    // dp=189 → gestationalWeek=27
    expect(computeGestationalAge(eddForDaysPregnant(189), TODAY).currentStage).toBe('T2');
  });

  it('T3 starts at wk 28 (dp=196)', () => {
    // dp=196 → gestationalWeek=28
    expect(computeGestationalAge(eddForDaysPregnant(196), TODAY).currentStage).toBe('T3');
  });

  it('deliveryWindowActive false at wk 36 (dp=252)', () => {
    expect(computeGestationalAge(eddForDaysPregnant(252), TODAY).deliveryWindowActive).toBe(false);
  });

  it('deliveryWindowActive true at wk 37 (dp=259)', () => {
    expect(computeGestationalAge(eddForDaysPregnant(259), TODAY).deliveryWindowActive).toBe(true);
  });

  it('progress is 0 for all negative daysPregnant (clamped)', () => {
    expect(computeGestationalAge(eddForDaysPregnant(-28), TODAY).progress).toBe(0);
    expect(computeGestationalAge(eddForDaysPregnant(-1), TODAY).progress).toBe(0);
  });

  it('progress is 1 for daysPregnant >= 280 (clamped)', () => {
    expect(computeGestationalAge(eddForDaysPregnant(280), TODAY).progress).toBe(1);
    expect(computeGestationalAge(eddForDaysPregnant(308), TODAY).progress).toBe(1);
  });
});

// ─── weekToTargetDate (Surface 2 — ANC inverse helper NET-NEW) ────────────────
// Formula: nextTargetDate = edd − (40 − targetWeek) × 7 (civil, UNCLAMPED).
// Built on parseCivilDateMs / civil arithmetic — no new date library.
// Tests are golden vectors on (edd, targetWeek) tuples; they verify the civil-
// date arithmetic is correct without embedding clinically-assumed week values.

describe('weekToTargetDate — NET-NEW inverse (edd → targetDate for a given week)', () => {
  // Golden vector 1: EDD = 2026-08-01, targetWeek = 40 (the EDD itself)
  // edd − (40−40)×7 = edd − 0 = 2026-08-01
  it('returns the EDD itself when targetWeek === 40', () => {
    expect(weekToTargetDate('2026-08-01', 40)).toBe('2026-08-01');
  });

  // Golden vector 2: EDD = 2026-08-01, targetWeek = 36
  // edd − (40−36)×7 = edd − 28 days
  // 2026-08-01 − 28 days = 2026-07-04
  it('returns edd minus (40-targetWeek)*7 days for targetWeek=36', () => {
    expect(weekToTargetDate('2026-08-01', 36)).toBe('2026-07-04');
  });

  // Golden vector 3: EDD = 2026-08-01, targetWeek = 20
  // edd − (40−20)×7 = edd − 140 days
  // 2026-08-01 − 140 days: 31 Jul + 1 Aug = 31 days in Jul, so Aug-1 minus 140:
  // Aug-1 is day 213 of 2026; 213 - 140 = day 73 = March 14 (2026 is not a leap year)
  // 2026: Jan=31, Feb=28, Mar: day 73 = Jan(31)+Feb(28)+Mar(14)=73 → 2026-03-14
  it('returns edd minus (40-targetWeek)*7 days for targetWeek=20', () => {
    expect(weekToTargetDate('2026-08-01', 20)).toBe('2026-03-14');
  });

  // Golden vector 4: computed date before year start (EDD early in year, early target)
  // EDD = 2026-03-01, targetWeek = 12
  // edd − (40−12)×7 = edd − 196 days
  // 2026-03-01 = day 60; 60 - 196 = day -136 in 2025
  // 2025 has 365 days; day 365 - 136 + 1 = day 229 → 2025-08-17
  // Jan=31, Feb=28 (2025 non-leap), Mar=31, Apr=30, May=31, Jun=30, Jul=31, Aug=17
  // 31+28+31+30+31+30+31+17=229 ✓
  it('returns a date that may be before the start of the year (UNCLAMPED)', () => {
    expect(weekToTargetDate('2026-03-01', 12)).toBe('2025-08-17');
  });

  // Golden vector 5: EDD = 2026-08-01, targetWeek = 28
  // edd − (40−28)×7 = edd − 84 days = 2026-08-01 − 84 days
  // Aug-1 − 84: Aug has 31, back into Jul: 84-1=83 before Aug. Jul=31→83-31=52 before Jul.
  // Jun=30→52-30=22 before Jun. May=31→22 more: May 31-22=May 9. So 2026-05-09.
  it('returns edd minus (40-targetWeek)*7 days for targetWeek=28', () => {
    expect(weekToTargetDate('2026-08-01', 28)).toBe('2026-05-09');
  });
});
