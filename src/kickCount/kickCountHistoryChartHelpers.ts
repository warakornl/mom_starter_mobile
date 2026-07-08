/**
 * kickCountHistoryChartHelpers.ts — pure helpers for KickCountHistoryScreen
 * chart + date-range picker.
 *
 * All functions are pure (no React, no native APIs) so they are testable
 * in the node jest environment.
 *
 * K-8: no logging of session data anywhere in this file.
 * SD-9: no health data passed through route params.
 *
 * Tested by KickCountHistoryChartIntegration.test.ts.
 */

import { bucketCivilDay } from '../calendar/civilDayBucketer';
import type { KickCountSessionRecord } from './kickCountTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum allowed range span in days (prevents unreadable bar chart). */
export const MAX_RANGE_DAYS = 366;

// ─── Date arithmetic ──────────────────────────────────────────────────────────

/**
 * Subtract N days from a "YYYY-MM-DD" string using UTC arithmetic to avoid
 * DST / local-midnight ambiguity.
 */
function subtractDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const result = new Date(Date.UTC(y, m - 1, d - n));
  const yy = result.getUTCFullYear();
  const mm = String(result.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(result.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ─── Default range ────────────────────────────────────────────────────────────

/**
 * Default "to" date = today (device civil date passed as "YYYY-MM-DD").
 */
export function buildDefaultToDate(today: string): string {
  return today;
}

/**
 * Default "from" date = today − 6 so the default range is [today−6, today]
 * = 7 days inclusive (last 7 days).
 */
export function buildDefaultFromDate(today: string): string {
  return subtractDays(today, 6);
}

// ─── Preset range helpers ─────────────────────────────────────────────────────

/**
 * Return fromDate for an N-day preset (e.g. 7, 14, 30).
 * toDate is always today.
 */
export function fromDateForPreset(today: string, days: number): string {
  return subtractDays(today, days - 1);
}

// ─── Range guards ─────────────────────────────────────────────────────────────

/**
 * Clamp toDate so it is never after today.
 * If toDate > today, returns today.
 */
export function clampToDate(toDate: string, today: string): string {
  return toDate > today ? today : toDate;
}

/**
 * Clamp fromDate so it is never after toDate.
 * If fromDate > toDate, returns toDate.
 */
export function clampFromDate(fromDate: string, toDate: string): string {
  return fromDate > toDate ? toDate : fromDate;
}

/**
 * Enforce maximum range span: if toDate − fromDate > MAX_RANGE_DAYS, clamp
 * fromDate forward to toDate − MAX_RANGE_DAYS.
 */
export function enforceMaxSpan(fromDate: string, toDate: string): string {
  const fromMs = new Date(fromDate + 'T00:00:00Z').getTime();
  const toMs = new Date(toDate + 'T00:00:00Z').getTime();
  const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_RANGE_DAYS) {
    return subtractDays(toDate, MAX_RANGE_DAYS);
  }
  return fromDate;
}

// ─── List filter ──────────────────────────────────────────────────────────────

/**
 * Return sessions whose startedAt civil day (date-part, FLAG-1) falls within
 * [fromDate, toDate] inclusive.
 *
 * K-8: no logging of session data.
 */
export function filterSessionsToRange(
  sessions: KickCountSessionRecord[],
  fromDate: string,
  toDate: string,
): KickCountSessionRecord[] {
  return sessions.filter((s) => {
    const day = bucketCivilDay(s.startedAt);
    return day >= fromDate && day <= toDate;
  });
}
