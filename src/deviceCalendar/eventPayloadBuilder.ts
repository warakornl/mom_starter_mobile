/**
 * eventPayloadBuilder — pure function: (appointment, privacyLevel) → CalendarEventPayload
 *
 * Privacy is enforced BY CONSTRUCTION here (not by discipline):
 *   - Generic branch reads ONLY scheduledAt → fixed title + empty location/notes.
 *     Health leakage is structurally impossible in Generic mode.
 *   - Descriptive branch may carry strings but only per CAL-SA-10/11/12/13:
 *     title = appointment.title (user_created) OR ANC_APPOINTMENT_TITLE (from_suggestion)
 *     notes = appointment.note verbatim
 *     location = '' ALWAYS (no structured location field in R-A model, CAL-SA-12)
 *
 * CS-TITLE-1: negative tests in __tests__/eventPayloadBuilder.test.ts
 * Trace: architecture §4, functional §3, compliance §3, legal §3.
 *
 * SECURITY: NEVER log payload values from this function (they may contain user notes).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Generic default title — the lock-screen-safe mask. CS-TITLE-1 #1. */
export const ANC_LOCK_SCREEN_TITLE = 'การแจ้งเตือน';

/** Descriptive constant for from_suggestion appointments. CAL-SA-11. */
export const ANC_APPOINTMENT_TITLE = 'นัดตรวจครรภ์';

/** Default event duration in minutes (OQ-CAL-9 pin). */
export const DEFAULT_DURATION_MIN = 60;

/** Timezone used for converting floating-civil scheduledAt (FLAG-1, Thailand). */
export const APPOINTMENT_TIMEZONE = 'Asia/Bangkok';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrivacyLevel = 'generic' | 'descriptive';

/**
 * Appointment input fields this builder consumes.
 * Mirrors ChecklistItem category=appointment in the frozen R-A model.
 */
export interface AppointmentInput {
  id: string;
  category: string;
  /** User-typed title (used in Descriptive+user_created only). */
  title: string;
  /** Floating-civil ISO "YYYY-MM-DDTHH:mm" — Gregorian, no timezone (FLAG-1). */
  scheduledAt: string;
  /** Free-text note — verbatim to calendar notes in Descriptive only (CAL-SA-13). */
  note: string;
  source: 'user_created' | 'from_suggestion';
  done: boolean;
}

/**
 * The payload handed to expoCalendarGateway.
 * Full-field: every write sends ALL fields (enables re-mask to Generic by overwrite).
 */
export interface CalendarEventPayload {
  title: string;
  /** Always '' in MVP (CAL-SA-12). */
  location: string;
  /** '' in Generic; appointment.note verbatim in Descriptive. */
  notes: string;
  startDate: Date;
  endDate: Date;
  timeZone: string;
  allDay: boolean;
}

// ─── civilToAbsolute ──────────────────────────────────────────────────────────

/**
 * Convert a floating-civil "YYYY-MM-DDTHH:mm" (Gregorian, FLAG-1) to an
 * absolute Date in Asia/Bangkok wall-clock time.
 *
 * Guard: NEVER add 543 years (พ.ศ. is display-only — CAL-SA-16).
 */
export function civilToAbsolute(scheduledAt: string, timeZone: string): Date {
  // Parse the civil string — no timezone suffix, so JS would use local TZ if we
  // pass it directly to `new Date()`.  We must interpret it in Asia/Bangkok.
  // Strategy: build components, then use Intl to get the UTC offset at that wall-clock
  // moment for the target zone and apply it.
  const [datePart, timePart = '00:00'] = scheduledAt.split('T');
  const [yearStr, monthStr, dayStr] = datePart.split('-');
  const [hourStr, minuteStr] = timePart.split(':');

  const year   = parseInt(yearStr,   10);
  const month  = parseInt(monthStr,  10) - 1; // JS months 0-indexed
  const day    = parseInt(dayStr,    10);
  const hour   = parseInt(hourStr,   10);
  const minute = parseInt(minuteStr, 10);

  // off-by-543 guard (CAL-SA-16): reject years that look like Buddhist Era
  if (year > 2500) {
    throw new Error(
      `eventPayloadBuilder: scheduledAt year ${year} looks like พ.ศ. — must use Gregorian. (CAL-SA-16)`,
    );
  }

  // Use Intl.DateTimeFormat to find the UTC offset for Asia/Bangkok at the given
  // civil instant. Thailand uses UTC+7 with no DST, so this is effectively always
  // UTC+7, but we use the Intl API to be correct by construction.
  //
  // Approach: create a tentative Date in UTC (treating the civil time as UTC),
  // then read back the local parts via the target zone's Intl formatter.
  // The difference between the parts gives us the offset we need to apply.
  const tentative = new Date(Date.UTC(year, month, day, hour, minute));

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Parse the formatted parts to get wall-clock in target zone
  const parts = fmt.formatToParts(tentative);
  const get = (type: string) =>
    parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  const tzYear   = get('year');
  const tzMonth  = get('month') - 1;
  const tzDay    = get('day');
  const tzHour   = get('hour') % 24;  // en-CA hour12=false can give 24
  const tzMinute = get('minute');

  // Compute drift between tentative UTC date (which we treated as civil) and
  // what the zone says the wall-clock is at that UTC moment
  const tzDate = new Date(Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute));
  const drift  = tzDate.getTime() - tentative.getTime(); // ms

  // The real UTC instant = tentative - drift
  return new Date(tentative.getTime() - drift);
}

// ─── eventPayloadBuilder ──────────────────────────────────────────────────────

/**
 * Pure function: builds the full-field calendar event payload.
 *
 * Re-mask semantics: every call returns a COMPLETE payload so that updating
 * an event with a Generic payload overwrites ALL fields (title+location+notes),
 * clearing any prior Descriptive content. AC-5.2 satisfied by construction.
 *
 * @throws if appointment.category !== 'appointment' (defense-in-depth, AC-2.6)
 */
export function eventPayloadBuilder(
  appointment: AppointmentInput,
  privacyLevel: PrivacyLevel,
): CalendarEventPayload {
  // Defense-in-depth category guard (CAL-SA-01 A1, AC-2.6)
  if (appointment.category !== 'appointment') {
    throw new Error(
      `eventPayloadBuilder: expected category='appointment', got '${appointment.category}'. Bridge must not pass non-appointment records.`,
    );
  }

  const startDate = civilToAbsolute(appointment.scheduledAt, APPOINTMENT_TIMEZONE);
  const endDate   = new Date(startDate.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
  const allDay    = false; // timed appointment (OQ-CAL-2 all-day: T2 case — out of MVP scope)

  if (privacyLevel === 'generic') {
    // ── GENERIC BRANCH ──
    // Reads ONLY scheduledAt. No access to appointment.title, .note, or any clinical field.
    // Health leakage is STRUCTURALLY IMPOSSIBLE here (CS-TITLE-1 #1-3, architecture §4.1).
    return {
      title:    ANC_LOCK_SCREEN_TITLE,
      location: '',
      notes:    '',
      startDate,
      endDate,
      timeZone: APPOINTMENT_TIMEZONE,
      allDay,
    };
  }

  // ── DESCRIPTIVE BRANCH ──
  // CAL-SA-11: title source guard.
  // from_suggestion titles may embed gestational week/test name/clinic/results (AC-5.3 #4
  // forbidden specifics) → masked with ANC_APPOINTMENT_TITLE constant.
  // user_created titles are the mother's own words → used verbatim.
  const title =
    appointment.source === 'user_created'
      ? appointment.title
      : ANC_APPOINTMENT_TITLE;

  // CAL-SA-12: location ALWAYS empty in MVP (no structured location field in R-A model).
  // CAL-SA-13: notes = appointment.note verbatim (opaque user-typed text, never parsed).
  return {
    title,
    location: '',
    notes:    appointment.note,
    startDate,
    endDate,
    timeZone: APPOINTMENT_TIMEZONE,
    allDay,
  };
}
