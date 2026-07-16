/**
 * buddhistDateGuard.ts — SINGLE shared source of truth for the พ.ศ./ค.ศ.
 * (Buddhist-Era / Christian-Era) year-trap guard used by every free-typed
 * YYYY-MM-DD date field in the pregnancy date screens.
 *
 * Task #40 (centralize date-entry + BE-year guard): previously this guard was
 * duplicated per screen with two SLIGHTLY different behaviours:
 *   - ProfileSetupScreen: AUTO-CONVERTS a detected BE year (year > 2100) to CE
 *     (−543) and shows a calm inline notice — used for both the due-date field
 *     and the LMP helper field.
 *   - BirthEventScreen / LossConfirmScreen: REJECTS a detected BE year inline
 *     (no silent correction — a mistaken birth/loss date is higher-stakes than
 *     a mistaken EDD estimate) with no Continue-anyway path.
 *
 * Both behaviours share the EXACT same detection rule (year > 2100) and the
 * exact same underlying arithmetic (BE = CE + 543). This module extracts that
 * one rule + the two outcome shapes so every screen calls the SAME function
 * instead of re-implementing the threshold.
 *
 * Security: pure date-string arithmetic only — no logging, no network, no
 * side effects (K-8 safe — the values here are civil dates, not raw health
 * measurements, but we still never log them per repo-wide hygiene).
 */

/** BE years are always > this threshold for any date plausible in this app. */
export const BE_YEAR_THRESHOLD = 2100;

/** BE = CE + 543 (Thai solar-calendar era offset). */
const BE_CE_OFFSET = 543;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true when the leading 4-digit year segment of a YYYY-MM-DD string
 * looks like a Buddhist-Era year mistakenly typed into a Christian-Era field
 * (year > 2100 — no plausible Gregorian date in this app has a year that
 * high, so any such value is almost certainly BE input typed by habit).
 *
 * Does NOT require the full string to be a well-formed date — callers that
 * already validated format (e.g. via a `\d{4}-\d{2}-\d{2}` regex) can pass
 * the trimmed input directly. Malformed/short input returns false (let the
 * caller's own format validation handle it).
 */
export function isBuddhistEraYear(dateStr: string): boolean {
  if (dateStr.length < 4) return false;
  const yearNum = Number(dateStr.slice(0, 4));
  if (!Number.isFinite(yearNum)) return false;
  return yearNum > BE_YEAR_THRESHOLD;
}

/**
 * BE/CE year-trap guard — AUTO-CONVERT variant.
 *
 * A free-typed YYYY-MM-DD field accepts a Buddhist-era (BE) year (e.g. 2569)
 * as if it were Christian-era (CE), silently saving a date ~543 years off.
 * BE = CE + 543, so any parsed year > 2100 is almost certainly a BE year
 * typed by habit (Thai civil documents default to BE).
 *
 * Returns the corrected YYYY-MM-DD string (BE→CE, −543) when the year is a
 * detected BE year, otherwise returns the input string unchanged.
 *
 * Used where a silent, reversible auto-correction (with a calm inline notice)
 * is the appropriate response — e.g. an estimated due-date field.
 */
export function convertBuddhistEraYearIfNeeded(dateStr: string): { corrected: string; wasBe: boolean } {
  const [y, m, d] = dateStr.split('-');
  const yearNum = Number(y);
  if (yearNum > BE_YEAR_THRESHOLD) {
    const ceYear = String(yearNum - BE_CE_OFFSET).padStart(4, '0');
    return { corrected: `${ceYear}-${m}-${d}`, wasBe: true };
  }
  return { corrected: dateStr, wasBe: false };
}

/**
 * BE/CE year-trap guard — REJECT variant.
 *
 * Used where the field records a higher-stakes retrospective event (an actual
 * birth date or loss date) rather than an estimate: a detected BE year is
 * REJECTED inline (no silent correction, no Continue-anyway path) so the
 * mother must consciously re-type the intended Gregorian year herself.
 *
 * @param dateStr trimmed input — caller should have already checked the
 *   `\d{4}-\d{2}-\d{2}` shape before calling this (this function only checks
 *   the year-trap rule, not general format validity).
 */
export function isBeYearRejected(dateStr: string): boolean {
  return isBuddhistEraYear(dateStr);
}
