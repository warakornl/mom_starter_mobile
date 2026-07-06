/**
 * monthYearFormatter — pure display helper for YYYY-MM → human-readable month.
 *
 * Used by the DoctorPdfScreen month picker (FIX 3) to show the selected month
 * in Thai long form (Buddhist Era) or English.
 *
 * Reuses MONTHS from messages.ts — the single source of truth for month names
 * shared by the rest of the app's date display. No new month tables.
 *
 * Examples:
 *   formatYearMonth('2026-04', 'th') → "เมษายน พ.ศ. 2569"
 *   formatYearMonth('2026-04', 'en') → "April 2026"
 */

import { MONTHS } from '../i18n/messages';
import type { Locale } from '../auth/types';

/**
 * Format a YYYY-MM string for display in the month picker field.
 *
 *   th  → "<ThaiMonth> พ.ศ. <CE year + 543>"   e.g. "เมษายน พ.ศ. 2569"
 *   en  → "<Month> <year>"                       e.g. "April 2026"
 *
 * NOTE: "display only" — never affects date range computation (that
 * continues to use the raw YYYY-MM string via applyMonthFromChanged /
 * applyMonthToChanged).
 */
export function formatYearMonth(yyyyMm: string, locale: Locale): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (locale === 'th') {
    return `${MONTHS.th[m - 1]} พ.ศ. ${y + 543}`;
  }
  return `${MONTHS.en[m - 1]} ${y}`;
}
