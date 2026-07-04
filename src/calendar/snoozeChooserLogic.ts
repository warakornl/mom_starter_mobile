/**
 * snoozeChooserLogic.ts — Pure logic for the medication snooze chooser.
 *
 * All functions are pure (no side effects, no native calls, no React) — safe to
 * unit-test directly in Node.js / Jest.
 *
 * Design ref: functional-spec §2 (snooze state machine, medication-only 10/30/60)
 *             screens-spec §5.3 (snooze chooser visual design)
 *
 * Routing rule (spec §2.1):
 *   - Reminder.type === 'medication' → show the 10/30/60 chooser
 *   - All other types → apply fixed now + 60 min, no chooser (unchanged from Task 2)
 *
 * SD-11 (INV-MR-2): no drug name or dose is referenced here; the caller resolves
 * the correct title separately.
 */

import type { ReminderType } from '../sync/syncTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

/** The three valid snooze durations (minutes). */
export type SnoozeDuration = 10 | 30 | 60;

/** One entry in the snooze options list shown by the chooser. */
export interface SnoozeOption {
  /** Duration in minutes (10, 30, or 60). */
  minutes: SnoozeDuration;
  /** Absolute Date at which the snooze alarm will fire (now + minutes). */
  alertsAt: Date;
  /** Formatted "HH:mm" string for the sub-label (pre-computed at render time). */
  alertsAtStr: string;
}

// ─── computeSnoozedUntil ─────────────────────────────────────────────────────

/**
 * Compute the absolute snoozedUntil Date for a given duration choice.
 *
 * snoozedUntil = now + chosen minutes (absolute UTC instant). The result is
 * stored on the ReminderOccurrenceRecord and used as the OS alarm fire time.
 *
 * @param minutes  Chosen duration: 10, 30, or 60
 * @param now      Current wall-clock Date (injected for testability)
 */
export function computeSnoozedUntil(minutes: SnoozeDuration, now: Date): Date {
  return new Date(now.getTime() + minutes * 60 * 1000);
}

// ─── isMedicationReminder ────────────────────────────────────────────────────

/**
 * Routing predicate: returns true iff the occurrence belongs to a medication
 * reminder (the only type that uses the 10/30/60 chooser — spec §2.1).
 *
 * All other types (kick_count, feeding, appointment, supply_restock, custom)
 * keep the fixed 1-hour snooze path with no chooser (spec §2.3).
 *
 * @param type  Parent Reminder.type of the tapped occurrence
 */
export function isMedicationReminder(type: ReminderType): boolean {
  return type === 'medication';
}

// ─── formatSnoozeTime ────────────────────────────────────────────────────────

/**
 * Format a Date as a zero-padded "HH:mm" string (local time).
 * Used for the alertsAt sub-label in each chooser option row.
 *
 * @param d  Date to format
 */
export function formatSnoozeTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── getSnoozeOptions ────────────────────────────────────────────────────────

/**
 * Build the three snooze option entries for the chooser, with pre-computed
 * alertsAt dates and formatted time strings.
 *
 * Called at chooser render time; `now` is injected so tests can pin the clock.
 *
 * @param now  Current wall-clock Date (injected for testability)
 */
export function getSnoozeOptions(now: Date): SnoozeOption[] {
  const durations: SnoozeDuration[] = [10, 30, 60];
  return durations.map((minutes) => {
    const alertsAt = computeSnoozedUntil(minutes, now);
    return {
      minutes,
      alertsAt,
      alertsAtStr: formatSnoozeTime(alertsAt),
    };
  });
}
