/**
 * snoozeRouterLogic.ts — Pure routing function for CalendarScreen snooze action.
 *
 * Extracted as a thin testable unit (Minor 4) so the CalendarScreen routing
 * is fully locked by unit tests without needing to mount the full screen.
 *
 * Routing spec (functional-spec §2.1 / §2.3):
 *   - medication + any status     → 'chooser' (10/30/60 SnoozeChooserSheet)
 *   - non-medication + not-snoozed → 'fixed1h' (immediate 1 h, no chooser)
 *   - non-medication + snoozed    → 'none' (snooze option not offered)
 *
 * SD-11 boundary: this function does NOT receive drug name or dose. For 'chooser'
 * routes the caller handles the alarm title separately (MEDICATION_TITLE_TH).
 * For 'fixed1h' routes, the occurrence's displayTitle is threaded through for the
 * OS alarm (non-medication occurrences are not subject to SD-11 lock-screen hiding).
 *
 * All pure — no React, no native calls, no store access.
 */

import type { ReminderType, OccurrenceStatus } from '../sync/syncTypes';
import { isMedicationReminder } from './snoozeChooserLogic';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Discriminated union of possible snooze routing outcomes.
 *
 *   chooser — open the 10/30/60 SnoozeChooserSheet (medication only)
 *   fixed1h — apply a fixed 1-hour snooze immediately with no chooser;
 *             displayTitle is the in-app occurrence label (for OS alarm)
 *   none    — snooze option is not offered (non-medication already snoozed)
 */
export type SnoozeRoute =
  | { action: 'chooser' }
  | { action: 'fixed1h'; displayTitle: string }
  | { action: 'none' };

// ─── resolveSnoozeRoute ───────────────────────────────────────────────────────

/**
 * Determine the snooze action for a tapped occurrence.
 *
 * @param reminderType    Parent Reminder.type of the tapped occurrence
 * @param currentStatus   Current OccurrenceStatus of the tapped occurrence
 * @param displayTitle    In-app display title (for 'fixed1h' OS alarm; ignored for 'chooser')
 * @returns               SnoozeRoute discriminated union
 */
export function resolveSnoozeRoute(
  reminderType: ReminderType,
  currentStatus: OccurrenceStatus,
  displayTitle: string,
): SnoozeRoute {
  if (isMedicationReminder(reminderType)) {
    // Medication: always show the 10/30/60 chooser; re-snooze is allowed (spec §2.1).
    return { action: 'chooser' };
  }

  // Non-medication: snooze is only offered when NOT already snoozed (spec §2.3).
  if (currentStatus === 'snoozed') {
    return { action: 'none' };
  }

  // Non-medication, not yet snoozed: apply fixed 1-hour snooze immediately.
  return { action: 'fixed1h', displayTitle };
}
