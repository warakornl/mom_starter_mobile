/**
 * kickCountDailyTotals.ts — pure aggregation helper for the kick-count history chart.
 *
 * Builds a per-civil-day bar-chart series from local session records.
 *
 * FLAG-1: startedAt is floating-civil "YYYY-MM-DDTHH:mm" — bucket by date-part
 * only, NO timezone conversion. Uses bucketCivilDay from civilDayBucketer.
 *
 * Security:
 *   K-8: NEVER log movementCount or any session field (MOTHER-health data).
 *   No console.* calls anywhere in this file.
 *
 * Tested by kickCountDailyTotals.test.ts.
 */

import { bucketCivilDay } from '../calendar/civilDayBucketer';
import type { KickCountSessionRecord } from './kickCountTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

/** One data point in the daily bar chart. */
export interface DailyKickTotal {
  /** Civil date "YYYY-MM-DD". */
  date: string;
  /** Sum of movementCount across all sessions whose startedAt civil day = this date. */
  totalCount: number;
  /** Number of sessions whose startedAt civil day = this date. */
  sessionCount: number;
}

// ─── Date arithmetic helpers ──────────────────────────────────────────────────

/**
 * Add one calendar day to a "YYYY-MM-DD" string using UTC arithmetic to
 * avoid DST / local-midnight ambiguity.
 */
function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build a daily bar-chart series for the kick-count history chart.
 *
 * @param sessions  - All active sessions from kickCountSyncStore (any order).
 * @param fromDate  - Start civil date "YYYY-MM-DD" (inclusive).
 * @param toDate    - End civil date "YYYY-MM-DD" (inclusive).
 * @returns Ordered array of DailyKickTotal, one entry per civil day in
 *          [fromDate, toDate] (ascending). Days with no sessions have
 *          totalCount=0, sessionCount=0. Returns [] when fromDate > toDate.
 */
export function buildDailyKickTotals(
  sessions: KickCountSessionRecord[],
  fromDate: string,
  toDate: string,
): DailyKickTotal[] {
  // Guard: inverted range → empty
  if (fromDate > toDate) {
    return [];
  }

  // Build a lookup: civil date → { total, count }
  const lookup = new Map<string, { total: number; count: number }>();

  for (const session of sessions) {
    const day = bucketCivilDay(session.startedAt);
    // Skip sessions outside the requested range
    if (day < fromDate || day > toDate) {
      continue;
    }
    const existing = lookup.get(day) ?? { total: 0, count: 0 };
    lookup.set(day, {
      total: existing.total + session.movementCount,
      count: existing.count + 1,
    });
  }

  // Enumerate every civil day from fromDate to toDate (inclusive, ascending)
  const result: DailyKickTotal[] = [];
  let current = fromDate;
  while (current <= toDate) {
    const entry = lookup.get(current);
    result.push({
      date: current,
      totalCount: entry?.total ?? 0,
      sessionCount: entry?.count ?? 0,
    });
    current = addOneDay(current);
  }

  return result;
}
