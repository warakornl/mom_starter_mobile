/**
 * expensesScreenHandlers — pure handler utilities for ExpensesScreen.
 *
 * Extracted so the money and date logic is directly unit-testable without
 * rendering the screen.
 *
 * Security: no amounts or dates are logged here.
 */

// ─── Amount input filter ───────────────────────────────────────────────────────

/**
 * Filter a TextInput change value for the ฿ amount field.
 *
 * Rules:
 *   - Digits and a single decimal point are kept; everything else is stripped.
 *   - Only the first decimal point is kept (second and beyond are dropped).
 *   - At most 2 digits after the decimal point are kept.
 *
 * This replaces the old `/[^0-9]/g` strip which removed the decimal point and
 * caused "59.90" → "5990" (×100 bug). Now "59.90" stays "59.90" and the util
 * `bahtStringToSatang("59.90")` correctly converts it to 5990 satang (฿59.90).
 *
 * @param v Raw string from TextInput.onChangeText.
 * @returns Filtered string safe to pass to bahtStringToSatang().
 */
export function filterAmountInput(v: string): string {
  // Strip everything except digits and dots
  const onlyValidChars = v.replace(/[^0-9.]/g, '');
  // Split on decimal point
  const parts = onlyValidChars.split('.');
  if (parts.length === 1) {
    // No decimal — just digits
    return parts[0];
  }
  // Has decimal: integer part is before the first dot.
  // All digits after any dots are joined and truncated to 2 (extra dots dropped).
  // e.g. "5.9.0" → intPart="5", fracPart="9"+"0"→"90" → "5.90"
  const intPart = parts[0];
  const fracPart = parts.slice(1).join('').slice(0, 2);
  return `${intPart}.${fracPart}`;
}

// ─── Edit field population ────────────────────────────────────────────────────

/**
 * Convert integer satang to the string that should pre-populate the amount
 * TextInput in edit mode.
 *
 * Returns a 2-decimal-place string WITHOUT the ฿ prefix or thousands commas,
 * e.g. 5990 → "59.90", 6000 → "60.00".
 *
 * This replaces `String(Math.round(item.amount / 100))` which rounded 5990 to
 * 60 and caused a 10-satang precision loss on every edit.
 *
 * @param satang Integer satang stored in the record.
 * @returns Decimal string suitable for the amount TextInput value prop.
 */
export function satangToInputString(satang: number): string {
  return (satang / 100).toFixed(2);
}

// ─── Date validation ──────────────────────────────────────────────────────────

/**
 * Validate that a string is a well-formed, calendar-valid "YYYY-MM-DD" date.
 *
 * Rules:
 *   - Must match the regex /^\d{4}-\d{2}-\d{2}$/ exactly (zero-padded).
 *   - Month must be 1–12.
 *   - Day must be 1–31 (upper bound only; exact-day-of-month validation is
 *     deferred to the picker which only produces valid dates).
 *
 * @param s Candidate date string.
 * @returns true if the string is a structurally and range-valid civil date.
 */
export function isValidCivilDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}
