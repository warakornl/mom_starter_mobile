/**
 * ancReminderBuilder.ts — pure builder for ANC one-off appointment reminders.
 *
 * Surface 6: builds the ReminderRecord for calendarSyncStore.enqueueCreateReminder().
 * Called from AppointmentFormScreen.handleSave() ONLY when the reminder toggle is ON.
 *
 * PDPA-A4 invariants (hard-coded):
 *   displayTitle = ANC_LOCK_SCREEN_TITLE[locale] — GENERIC, never the appointment name
 *   hideOnLockScreen = true — suppresses content on lock screen for privacy
 *
 * FLAG-4 grammar:
 *   freq = 'one_off': timesOfDay/interval/until MUST be absent.
 *   startAt = (scheduledAt date − 1 day) at 18:00 (floating civil "YYYY-MM-DDTHH:mm")
 *
 * INV-A4: this function is pure — it has no side effects. The caller must call
 *   calendarSyncStore.enqueueCreateReminder() only on Save (never on Cancel).
 */

import type { ReminderRecord } from '../sync/syncTypes';
import { ANC_LOCK_SCREEN_TITLE } from '../suggestion/ancConfig';

// ─── startAt helper ───────────────────────────────────────────────────────────

/**
 * Compute the reminder startAt as floating civil "YYYY-MM-DDTHH:mm":
 *   (scheduledAt date − 1 day) at 18:00 local time.
 *
 * Input: floating civil "YYYY-MM-DDTHH:mm" (appointment's scheduledAt).
 * Output: floating civil "YYYY-MM-DDTHH:mm" (day before at 18:00).
 *
 * Uses UTC math on the civil date string to avoid DST boundary issues:
 * subtract one calendar day, then suffix with 'T18:00'.
 */
function computeReminderStartAt(scheduledAt: string): string {
  // Extract the date portion ("YYYY-MM-DD")
  const datePart = scheduledAt.slice(0, 10);
  // Parse as UTC midnight for safe arithmetic (no DST)
  const dateMs = new Date(`${datePart}T00:00:00Z`).getTime();
  const dayBeforeMs = dateMs - 86_400_000;
  const dayBefore = new Date(dayBeforeMs);
  const y = dayBefore.getUTCFullYear();
  const m = String(dayBefore.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dayBefore.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T18:00`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface BuildAncReminderInput {
  /** The id to assign to the new ReminderRecord. */
  id: string;
  /** The ChecklistItem.id this reminder is linked to. */
  checklistItemId: string;
  /** Appointment's scheduledAt — floating civil "YYYY-MM-DDTHH:mm". */
  scheduledAt: string;
  /** User's current locale — drives the PDPA-A4 generic display title. */
  locale: string;
  /** ISO 8601 UTC now — for createdAt/updatedAt. */
  now: string;
}

/**
 * Build the one-off ReminderRecord for an ANC appointment.
 *
 * PDPA-A4: displayTitle is always the GENERIC ANC_LOCK_SCREEN_TITLE,
 *   never the actual appointment name ("นัดตรวจครรภ์").
 *   hideOnLockScreen = true so the notification body is also suppressed.
 */
export function buildAncReminderRecord(input: BuildAncReminderInput): ReminderRecord {
  const { id, checklistItemId, scheduledAt, locale, now } = input;

  return {
    id,
    type: 'appointment',
    // PDPA-A4: generic lock-screen title — locale-selected but always generic
    displayTitle: locale === 'en' ? ANC_LOCK_SCREEN_TITLE.en : ANC_LOCK_SCREEN_TITLE.th,
    // PDPA-A4: suppress notification body on lock screen
    hideOnLockScreen: true,
    sourceRefType: 'checklist_item',
    sourceRefId: checklistItemId,
    recurrenceRule: {
      // one_off: timesOfDay/interval/until MUST be absent (FLAG-4 grammar)
      freq: 'one_off',
    },
    startAt: computeReminderStartAt(scheduledAt),
    active: true,
    // version 0 = new record; server assigns version ≥ 1 on push
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}
