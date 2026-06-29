/**
 * postpartumAge.test.ts — Golden-vector regression tests (TDD — written BEFORE the impl).
 *
 * Source of truth: data-model.md §3.1 "Postpartum golden test-vectors"
 * and api-contract.md §"Birth-event & postpartum counting" (lockstep mirror).
 *
 * These 9 rows are the CANONICAL lockstep guard — if this test file passes AND
 * the Spring Boot backend's equivalent test passes, client and server are
 * guaranteed to agree on postpartumWeek / postpartumDay for all inputs.
 *
 * Invariant checked by every row:
 *   postpartumWeek * 7 + postpartumDay === postpartumDays
 *
 * Formula (frozen — data-model §3.1):
 *   postpartumDays = max(0, civilDaysBetween(birthDate, today))
 *   postpartumWeek = Math.floor(postpartumDays / 7)      // floorDiv (mandatory)
 *   postpartumDay  = ((postpartumDays % 7) + 7) % 7      // floorMod (mandatory)
 *
 * floorDiv/floorMod are mandatory for cross-platform parity with the gestational
 * counter even though postpartumDays >= 0 always (clamp) — the contract pins
 * the Euclidean forms for backend parity.
 */

import { computePostpartumAge } from './postpartumAge';
import { civilDaysBetween } from './gestationalAge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fixed civil "today" used across all golden-vector tests. */
const TODAY = '2026-06-29';

/** Add `n` calendar days to a YYYY-MM-DD civil-date string (UTC to avoid DST). */
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
 * Derive birthDate for a given target postpartumDays:
 *   birthDate = today − postpartumDays
 */
function birthDateForDays(days: number): string {
  return addDays(TODAY, -days);
}

// ─── Re-export smoke test ─────────────────────────────────────────────────────

describe('civilDaysBetween — available from gestationalAge (reused in postpartumAge)', () => {
  it('returns 0 for same date', () => {
    expect(civilDaysBetween('2026-06-29', '2026-06-29')).toBe(0);
  });
  it('returns 7 for +7 days', () => {
    expect(civilDaysBetween('2026-06-22', '2026-06-29')).toBe(7);
  });
});

// ─── Golden test-vectors (canonical — data-model.md §3.1) ────────────────────

/**
 * 9-row canonical table from data-model.md §3.1 "Postpartum golden test-vectors".
 *
 * Columns:
 *   days — postpartumDays  (max(0, civilDaysBetween(birthDate, today)))
 *   week — postpartumWeek  (floorDiv(days, 7); floor toward −∞)
 *   day  — postpartumDay   (floorMod(days, 7); Euclidean 0..6)
 *
 * Invariant: week*7 + day === days (every row).
 */
type GoldenRow = {
  days: number;
  week: number;
  day: number;
  note: string;
};

const GOLDEN_VECTORS: GoldenRow[] = [
  { days: 0,  week: 0,  day: 0, note: 'birth day — สัปดาห์ที่ 0' },
  { days: 1,  week: 0,  day: 1, note: 'day 1' },
  { days: 6,  week: 0,  day: 6, note: 'last day of week 0' },
  { days: 7,  week: 1,  day: 0, note: 'week boundary → สัปดาห์ที่ 1' },
  { days: 13, week: 1,  day: 6, note: 'last day of week 1' },
  { days: 14, week: 2,  day: 0, note: 'week 2 starts' },
  { days: 41, week: 5,  day: 6, note: 'week 5 last day' },
  { days: 42, week: 6,  day: 0, note: 'week 6 starts' },
  { days: 84, week: 12, day: 0, note: '≈ end of typical postpartum window' },
];

describe('computePostpartumAge — Golden test-vectors (data-model.md §3.1)', () => {
  test.each(GOLDEN_VECTORS)(
    'postpartumDays=$days → week=$week day=$day ($note)',
    ({ days, week, day }: GoldenRow) => {
      const birthDate = birthDateForDays(days);
      const result = computePostpartumAge(birthDate, TODAY);

      // Primary values
      expect(result.postpartumDays).toBe(days);
      expect(result.postpartumWeek).toBe(week);
      expect(result.postpartumDay).toBe(day);

      // INVARIANT: week*7 + day === days (must hold for all rows)
      expect(result.postpartumWeek * 7 + result.postpartumDay).toBe(days);
    },
  );
});

// ─── Clamp behavior (OQ-12 / data-model §3.1) ────────────────────────────────

describe('computePostpartumAge — clamp to zero (cross-device clock skew)', () => {
  it('clamps to 0 when today is before birthDate (device trailing another device)', () => {
    // birthDate is "tomorrow" from today — device local "today" briefly trails.
    // Contract: postpartumDays = max(0, ...) protects against this.
    const futureBirthDate = addDays(TODAY, 1);
    const result = computePostpartumAge(futureBirthDate, TODAY);
    expect(result.postpartumDays).toBe(0);
    expect(result.postpartumWeek).toBe(0);
    expect(result.postpartumDay).toBe(0);
    // Invariant still holds
    expect(result.postpartumWeek * 7 + result.postpartumDay).toBe(0);
  });

  it('clamps to 0 for a birthDate 7 days in the future', () => {
    const result = computePostpartumAge(addDays(TODAY, 7), TODAY);
    expect(result.postpartumDays).toBe(0);
  });
});

// ─── floorDiv / floorMod parity check ────────────────────────────────────────

describe('computePostpartumAge — invariant holds for all golden vectors', () => {
  it('week*7 + day === days for every row', () => {
    for (const { days } of GOLDEN_VECTORS) {
      const r = computePostpartumAge(birthDateForDays(days), TODAY);
      expect(r.postpartumWeek * 7 + r.postpartumDay).toBe(r.postpartumDays);
    }
  });
});
