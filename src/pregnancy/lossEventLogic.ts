/**
 * lossEventLogic.ts — pure client-side validation for the optional loss-date field.
 *
 * Mirrors functional-spec §14.3 / §7.2 (server bounds), so the mother rarely
 * sees a 422. Both bounds map to the SAME sub-code 'range' by design — a
 * single non-directional sanity filter, never a judgement of the loss (TONE-2).
 *
 * LOSS-INV-11: lossDate is OPTIONAL / default-empty / skippable / never
 * mandatory. Confirming with an empty field is a full, unblocked success.
 *
 * Security: date-only (YYYY-MM-DD), no time-of-day, no metadata (S6).
 * NEVER log the resolved date value beyond what the UI already displays.
 */

import type { LossEventInput } from './types';

export type LossDateValidationResult =
  | { valid: true }
  | { valid: false; error: 'range' | 'malformed' };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lower floor: edd - 301 days (≈43 weeks before EDD — permissive, §7.2). */
const LOWER_FLOOR_DAYS = 301;

function isRealCalendarDate(iso: string): boolean {
  if (!DATE_ONLY_RE.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function addDaysUtc(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Validate an optional loss-date input against the client civil "today" and
 * the retained `edd` (functional-spec §14.3 / §7.2).
 *
 * @param rawInput   raw text from the date field — '' means "not set" (valid, omit)
 * @param todayCivil device-local civil date YYYY-MM-DD
 * @param edd        the profile's retained EDD YYYY-MM-DD (used for the lower floor)
 */
export function validateLossDate(
  rawInput: string,
  todayCivil: string,
  edd: string,
): LossDateValidationResult {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { valid: true };
  }

  if (!isRealCalendarDate(trimmed)) {
    return { valid: false, error: 'malformed' };
  }

  // Upper bound: lossDate <= today (client civil date).
  if (trimmed > todayCivil) {
    return { valid: false, error: 'range' };
  }

  // Lower bound: lossDate >= edd - 301d (same sub-code as upper bound, by design).
  const floor = addDaysUtc(edd, -LOWER_FLOOR_DAYS);
  if (trimmed < floor) {
    return { valid: false, error: 'range' };
  }

  return { valid: true };
}

/**
 * Builds the LossEventInput body from the raw date field text.
 *
 * Empty/omitted → {} (no lossDate key — server stores NULL, LOSS-INV-11).
 * Non-empty → { lossDate }.
 *
 * Caller MUST validate first (validateLossDate) — this function does not
 * re-validate; it only shapes the wire body.
 */
export function buildLossEventInput(rawInput: string): LossEventInput {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) return {};
  return { lossDate: trimmed };
}
