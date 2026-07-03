/**
 * captureValidation — typo-guard validation for Quick Capture self-log fields.
 *
 * Implements capture-ui.md §4 + self-log-behavior.md §2.
 *
 * PURPOSE: input-sanity guard ONLY — not a clinical range checker.
 *   Bounds prevent slipped decimals (6.42 vs 64.2) and stray letters.
 *   They are NOT medical limits; the app never judges a health value.
 *
 * INVARIANTS (INV-S3):
 *   - Hint copy NEVER says "too high/low," "abnormal," or suggests action.
 *   - Out-of-range but well-formed inputs are storable — she can confirm past
 *     the hint. Only a non-number or malformed time BLOCKS Save.
 *
 * Security: these functions receive user-typed plain strings (no ciphertext).
 *   Do NOT log numeric values in production (MOTHER-health SD-5).
 */

// ─── ValidationResult ─────────────────────────────────────────────────────────

export interface ValidationResult {
  /**
   * false = Save button disabled (non-number or malformed time — cannot be stored).
   * true  = Save button enabled (value is storable; hint may still be shown).
   */
  storable: boolean;
  /**
   * null    = no hint shown.
   * string  = quiet ⓘ hint in neutral ink/soft — NEVER status/attention colour
   *           (capture-ui §4: hint must not be mistaken for a health warning).
   */
  hint: string | null;
}

// ─── Hint copy (th / en) — INV-S3 compliant ──────────────────────────────────

/**
 * "Enter a number" — shown for non-parseable input (letters, malformed).
 * Copy never mentions health; purely about input format.
 */
export const HINT_NOT_A_NUMBER = 'กรอกเป็นตัวเลข / Enter a number';

/**
 * "Double-check this number" — shown for out-of-range but parseable input.
 * Neutral phrasing: plausibility check only, never a health verdict.
 */
export const HINT_DOUBLE_CHECK = 'ตรวจสอบตัวเลขอีกครั้ง / Double-check this number';

/**
 * "Pick a valid time" — shown for malformed time input.
 */
export const HINT_INVALID_TIME = 'เลือกเวลาที่ถูกต้อง / Pick a valid time';

// ─── Bounds (input-plausibility guards, NOT clinical ranges) ──────────────────

/** Weight bounds (kg) — guard against slipped decimals, not clinical limit */
export const WEIGHT_MIN = 20;
export const WEIGHT_MAX = 300;

/** BP bounds (mmHg, each field) — guard against stray letters / impossible input */
export const BP_MIN = 30;
export const BP_MAX = 300;

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validate weight input (kg).
 *
 * Accepts decimals (1-decimal per spec example "64.2").
 * storable = false ONLY for: empty input or non-parseable string.
 * Out-of-range [20–300] → storable: true, hint: DOUBLE_CHECK.
 */
export function validateWeight(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { storable: false, hint: null };
  }

  const num = parseFloat(trimmed);
  // Reject if NaN or contains non-numeric chars (e.g. "12x")
  if (isNaN(num) || !/^[\d]+(?:\.\d*)?$/.test(trimmed)) {
    return { storable: false, hint: HINT_NOT_A_NUMBER };
  }

  if (num < WEIGHT_MIN || num > WEIGHT_MAX) {
    return { storable: true, hint: HINT_DOUBLE_CHECK };
  }

  return { storable: true, hint: null };
}

/**
 * Validate blood pressure input (mmHg, integers only).
 *
 * Applies to BOTH systolic and diastolic fields.
 * storable = false for: empty, non-number, or decimal (BP must be integer).
 * Out-of-range [30–300] → storable: true, hint: DOUBLE_CHECK.
 *
 * INV-S1: BP 150 and 110 both return { storable: true, hint: null } —
 * identical validation result regardless of the clinical interpretation.
 */
export function validateBP(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { storable: false, hint: null };
  }

  const num = parseFloat(trimmed);
  // Reject NaN or non-integer (BP must be a whole number per spec)
  if (isNaN(num) || !Number.isInteger(num)) {
    return { storable: false, hint: HINT_NOT_A_NUMBER };
  }

  if (num < BP_MIN || num > BP_MAX) {
    return { storable: true, hint: HINT_DOUBLE_CHECK };
  }

  return { storable: true, hint: null };
}

/**
 * Validate HH:mm time input.
 *
 * storable = false for: malformed format or invalid hour/minute values.
 * A malformed time cannot be stored as a loggedAt bucket key (FLAG-1).
 */
export function validateTime(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed || !/^\d{1,2}:\d{2}$/.test(trimmed)) {
    return { storable: false, hint: HINT_INVALID_TIME };
  }

  const [hStr, mStr] = trimmed.split(':');
  const h = Number(hStr);
  const m = Number(mStr);

  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return { storable: false, hint: HINT_INVALID_TIME };
  }

  return { storable: true, hint: null };
}
