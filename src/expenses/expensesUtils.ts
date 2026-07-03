/**
 * expensesUtils — pure utility functions for the Expenses feature.
 *
 * ฿↔satang conversion:
 *   The API contract stores amounts as integer satang (฿1 = 100 satang) to
 *   avoid float drift.  The UI accepts whole-baht input and displays ฿ with
 *   2 decimal places (grouped thousands).
 *
 * Month total:
 *   Computed client-side (spec §4.5 / EX-1 — amounts may be client-encrypted).
 *   Filtering is done on the floating-civil incurredOn bucket key.
 *
 * Security: do NOT log amount, note, or incurredOn values.
 */

import type { ExpenseRecord, ExpenseCategory } from '../sync/syncTypes';

// ─── ฿ ↔ satang ──────────────────────────────────────────────────────────────

/**
 * Convert integer satang to a display string: "฿1,234.50"
 *
 * @param satang Integer satang value (฿1 = 100 satang).
 * @returns Display string with ฿ prefix, grouped thousands, 2 decimal places.
 */
export function satangToBaht(satang: number): string {
  const baht = satang / 100;
  // Format with grouped thousands and 2 decimal places
  const parts = baht.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `฿${intPart}.${parts[1]}`;
}

/**
 * Convert a user-typed baht string to integer satang.
 * Strips commas (user may type "1,200"), then multiplies by 100.
 *
 * @param bahtStr User-typed string (whole baht only per spec UI-E3).
 * @returns Integer satang, or 0 on invalid/empty input.
 */
export function bahtStringToSatang(bahtStr: string): number {
  if (!bahtStr || !bahtStr.trim()) return 0;
  // Strip commas (thousands separator typed by user)
  const cleaned = bahtStr.replace(/,/g, '').trim();
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface AmountValidationResult {
  valid: boolean;
  /** i18n key for the error message (only present when valid=false). */
  errorKey?: 'expenses.errorAmountRequired';
}

/**
 * Validate the amount field before save.
 *
 * Rules (spec §3.2):
 *   - Required (non-empty).
 *   - Must be a positive number (> 0).
 *   - Empty / zero / non-numeric / negative → rejected with a plain message,
 *     never coerced. "Enter an amount above zero." tone guard, not a verdict.
 *
 * @param bahtStr Raw user-typed string from the amount field.
 */
export function validateAmountInput(bahtStr: string): AmountValidationResult {
  const satang = bahtStringToSatang(bahtStr);
  if (satang <= 0) {
    return { valid: false, errorKey: 'expenses.errorAmountRequired' };
  }
  return { valid: true };
}

// ─── Month membership ─────────────────────────────────────────────────────────

/**
 * Return true if a floating-civil date string "YYYY-MM-DD" falls in the given
 * calendar month (civil year + 1-based month).
 *
 * Bucketing is on incurredOn (floating-civil, never TZ-shifted) — exactly as
 * the calendar uses scheduledAt.
 */
export function isInCivilMonth(incurredOn: string, year: number, month: number): boolean {
  const [y, m] = incurredOn.split('-').map(Number);
  return y === year && m === month;
}

// ─── Month total ──────────────────────────────────────────────────────────────

/**
 * Compute the total spending in satang for a civil month.
 *
 * Derived entirely client-side (spec §4.5 / EX-1: encrypted amounts cannot be
 * server-summed). Non-deleted records only. incurredOn decides the bucket.
 *
 * @param records All expense records (all months, all states).
 * @param year    Civil year (CE).
 * @param month   1-based civil month (1=January, 12=December).
 * @returns Total in satang (integer).
 */
export function computeMonthTotal(
  records: ExpenseRecord[],
  year: number,
  month: number,
): number {
  return records
    .filter((r) => !r.deletedAt && isInCivilMonth(r.incurredOn, year, month))
    .reduce((sum, r) => sum + r.amount, 0);
}

// ─── Category breakdown ───────────────────────────────────────────────────────

export interface CategoryBreakdownEntry {
  category: ExpenseCategory;
  totalSatang: number;
}

/**
 * Compute per-category sub-totals for a civil month.
 *
 * Result:
 *   - Only categories with totalSatang > 0 are included (spec §2.2).
 *   - Sorted high-to-low by totalSatang.
 *   - Non-deleted records only.
 *
 * @param records All expense records.
 * @param year    Civil year.
 * @param month   1-based civil month.
 */
export function computeCategoryBreakdown(
  records: ExpenseRecord[],
  year: number,
  month: number,
): CategoryBreakdownEntry[] {
  const map = new Map<ExpenseCategory, number>();

  records
    .filter((r) => !r.deletedAt && isInCivilMonth(r.incurredOn, year, month))
    .forEach((r) => {
      map.set(r.category, (map.get(r.category) ?? 0) + r.amount);
    });

  return Array.from(map.entries())
    .filter(([, total]) => total > 0)
    .map(([category, totalSatang]) => ({ category, totalSatang }))
    .sort((a, b) => b.totalSatang - a.totalSatang);
}

// ─── List grouping ────────────────────────────────────────────────────────────

/**
 * Filter and sort expense records for the list view:
 *   1. Only records in the given civil month.
 *   2. Excludes soft-deleted (tombstoned) records.
 *   3. Most recent incurredOn first; within the same date, most recently
 *      created first (stable createdAt tiebreak — US-E4).
 *
 * @param records All expense records.
 * @param year    Civil year.
 * @param month   1-based civil month.
 */
export function groupExpensesByDate(
  records: ExpenseRecord[],
  year: number,
  month: number,
): ExpenseRecord[] {
  return records
    .filter((r) => !r.deletedAt && isInCivilMonth(r.incurredOn, year, month))
    .slice()
    .sort((a, b) => {
      // Primary: incurredOn descending (most recent first)
      const dateCompare = b.incurredOn.localeCompare(a.incurredOn);
      if (dateCompare !== 0) return dateCompare;
      // Tiebreak: createdAt descending (most recently created first)
      return b.createdAt.localeCompare(a.createdAt);
    });
}
