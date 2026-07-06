/**
 * ancHandleStart.ts — pure computation for the ANC cadence "Start" action.
 *
 * Called from SuggestionFlowScreen.handleStart when key === 'anc_next_checkup'.
 * Separated from the component so the logic is unit-testable without rendering.
 *
 * Returns null when preconditions are unmet (missing EDD, past last target)
 * so the caller can fall through to the generic onCalendar() path.
 *
 * LOAD-BEARING:
 *   resurfacesAt = new Date(`${nextTargetDate}T00:00`).toISOString()
 *   The T00:00 suffix forces JS to parse as LOCAL midnight.
 *   A bare 'YYYY-MM-DD' would parse as UTC midnight, which is off by +7 hours
 *   at UTC+7, causing the re-arm to suppress the offer one extra day in Thailand.
 *
 * INV-A4: this module builds the payload only — it does NOT write anything.
 *   The caller (SuggestionFlowScreen) calls suggestionStore.start() and
 *   onAncStart() after receiving the non-null return value.
 */

import type { AncFormPrefill } from './types';
import {
  ANC_TARGET_WEEKS,
  PAST_CLAMP_DAYS,
  ANC_CATALOG_COPY,
  ANC_APPOINTMENT_TITLE,
} from './ancConfig';
import { weekToTargetDate } from '../pregnancy/gestationalAge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AncStartInput {
  edd: string | null | undefined;
  gestationalWeek: number;
  /** Wall-clock now — used for past-date clamping of the prefill date. */
  now: Date;
  /** Value of the ANC_PREFILL_DATE config flag at call time. */
  ancPrefillDateEnabled: boolean;
}

export interface AncStartPayload {
  /**
   * ISO 8601 UTC string to pass to suggestionStore.start(key, resurfacesAt).
   * Computed from nextTargetDate using LOCAL T00:00 parse (LOAD-BEARING).
   */
  resurfacesAt: string;
  /** Prefill data to pass to AppointmentFormScreen via onAncStart(). */
  prefill: AncFormPrefill;
}

// ─── Helper: YYYY-MM-DD string for (now + n days) using LOCAL civil components ──
//
// DEF-02 fix: use LOCAL date components (getFullYear/Month/Date) rather than UTC
// (getUTCFullYear/Month/Date).  Between 00:00–07:00 LOCAL at UTC+7, getUTC* returns
// the PREVIOUS calendar day, causing the past-date clamp to fire a day late.
// The spec defines "today" as the device-local civil date — matching localCivilToday()
// and all other civil-date helpers in the app.

function localCivilDateString(now: Date, offsetDays: number): string {
  const ms = now.getTime() + offsetDays * 86_400_000;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Builds the ANC start payload — pure, no side effects.
 *
 * Returns null when:
 *   - edd is absent (null | undefined)
 *   - gestationalWeek >= max(ANC_TARGET_WEEKS) (no next target week)
 *
 * The caller is responsible for:
 *   1. Calling suggestionStore.start('anc_next_checkup', payload.resurfacesAt)
 *   2. Calling onAncStart(payload.prefill)
 */
export function buildAncStartPayload(input: AncStartInput): AncStartPayload | null {
  const { edd, gestationalWeek, now, ancPrefillDateEnabled } = input;

  // Guard: EDD required
  if (!edd) return null;

  // Guard: nextTargetWeek = smallest target strictly > gestationalWeek
  const nextTargetWeek = ANC_TARGET_WEEKS.find((w) => w > gestationalWeek);
  if (nextTargetWeek === undefined) return null;

  // Compute the calendar date of the next target (unclamped, UTC-civil)
  const nextTargetDate = weekToTargetDate(edd, nextTargetWeek);

  // LOAD-BEARING: T00:00 LOCAL parse (not bare YYYY-MM-DD UTC).
  // This is the re-arm date written to the store.
  const resurfacesAt = new Date(`${nextTargetDate}T00:00`).toISOString();

  // Compute the prefill date (clamped to today+PAST_CLAMP_DAYS when past)
  // DEF-02 fix: use LOCAL civil convention so "today" matches the device-local date.
  const nowCivilDate = localCivilDateString(now, 0);
  const isPast = nextTargetDate < nowCivilDate;
  const nextANCDate = isPast
    ? localCivilDateString(now, PAST_CLAMP_DAYS)
    : nextTargetDate;

  // Build the AncFormPrefill payload
  const prefill: AncFormPrefill = {
    title: ANC_APPOINTMENT_TITLE,
    date: ancPrefillDateEnabled ? nextANCDate : undefined,
    dateLabel: ancPrefillDateEnabled ? ANC_CATALOG_COPY.dateLabelOn : ANC_CATALOG_COPY.dateLabelOff,
    time: '09:00',
    category: 'anc_visit',
    attachReminder: false,
    headerDisclaimer: ANC_CATALOG_COPY.formDisclaimer,
    fromSuggestion: true,
    sourceSuggestionStateId: 'anc_next_checkup',
  };

  return { resurfacesAt, prefill };
}
