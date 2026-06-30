/**
 * notificationService — local notification scheduling for calendar reminders and appointments.
 *
 * Wraps expo-notifications for schedule / cancel / reconcile operations.
 *
 * Schedule strategy:
 *   Reminders: expand occurrences via recurrenceExpander, schedule next ROLLING_WINDOW
 *   future occurrences.  iOS limits apps to 64 pending notifications, so
 *   ROLLING_WINDOW = 15 (4 active reminders × 15 = 60; leaves headroom for appointments).
 *   Appointments: one notification per item, fired APPOINTMENT_LEAD_MS (30 min) before.
 *
 * Idempotency:
 *   Reminder notifications use occurrenceId (uuidv5) as the Expo notification identifier.
 *   expo-notifications replaces an existing slot with the same identifier, so
 *   scheduling twice never fires twice.
 *   Appointment notifications use item.id as identifier.
 *
 * Cancellation:
 *   cancelNotificationsForReminder — fetches all scheduled, filters data.reminderId, cancels.
 *   cancelNotificationForOccurrence — cancels by occurrenceId directly.
 *   cancelNotificationsForAppointment — cancels by item.id directly.
 *
 * Reconcile (after sync pull):
 *   1. Build expected set from active reminders + upcoming appointments.
 *   2. Cancel stale (in OS scheduler but not expected).
 *   3. Schedule missing (expected but not yet in OS scheduler).
 *   Safe to call multiple times — idempotent.
 *
 * Deep-link data payload:
 *   Reminder: { type: 'reminder', reminderId, occurrenceId, scheduledLocalTime }
 *   Appointment: { type: 'appointment', itemId, scheduledAt }
 *   App.tsx reads this in addNotificationResponseReceivedListener → navigate('Calendar').
 *
 * Security:
 *   When hideOnLockScreen=true, notification title is replaced with 'แจ้งเตือน' (generic).
 *   displayTitle is used only when hideOnLockScreen is false/absent.
 *   Do NOT log reminder content, appointment notes, or any health data here.
 */

import * as Notifications from 'expo-notifications';
import type { PermissionStatus } from 'expo-modules-core';
import { expand } from '../recurrence/recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import type { ReminderRecord, ChecklistItemRecord } from '../sync/syncTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of future occurrences to schedule per reminder.
 * iOS hard limit: 64 pending notifications per app.
 * With up to ~4 active reminders: 4 × 15 = 60 reminder slots + ~4 appointment slots = 64.
 * Tune down if the app grows to more concurrent reminders.
 */
export const ROLLING_WINDOW = 15;

/**
 * Lead time (milliseconds) before a scheduled appointment to fire the notification.
 * Default: 30 minutes.
 */
export const APPOINTMENT_LEAD_MS = 30 * 60 * 1000;

// ─── Helpers (exported for testing) ─────────────────────────────────────────

/**
 * Convert a floating-civil "YYYY-MM-DDTHH:mm" string to a JS Date in the
 * device's local timezone.
 *
 * Note: `new Date("YYYY-MM-DDTHH:mm")` is interpreted as UTC in V8 (no zone suffix).
 * We parse the components manually so the resulting Date is in local time, matching
 * the civil-day semantics used throughout the app.
 */
export function civilToLocalDate(civil: string): Date {
  const [datePart, timePart] = civil.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Format a JS Date as "YYYY-MM-DD" using the device's local timezone. */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Add `n` civil days to a "YYYY-MM-DD" string (UTC epoch math to avoid DST shifts). */
function addDaysCivil(isoDate: string, n: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Return true if the device has notification permission granted. */
async function hasGrantedPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

// ─── Permission ───────────────────────────────────────────────────────────────

/**
 * Request notification permission from the OS.
 *
 * Returns 'granted' immediately if already authorised; otherwise prompts the
 * user and returns their decision ('granted' | 'denied' | 'undetermined').
 *
 * Call this before the first reminder save or on first calendar open.
 * Callers should handle 'denied' gracefully — scheduling is silently skipped.
 */
export async function requestNotificationPermission(): Promise<PermissionStatus> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return existing.status as PermissionStatus;
  const result = await Notifications.requestPermissionsAsync();
  return result.status as PermissionStatus;
}

// ─── Schedule reminder notifications ─────────────────────────────────────────

/**
 * Schedule the next ROLLING_WINDOW future occurrences of a reminder.
 *
 * Steps:
 *   1. Expand occurrences for the next ROLLING_WINDOW × 2 civil days (generous
 *      window so sparse every_n_days rules still fill ROLLING_WINDOW slots).
 *   2. Filter to strictly future occurrences (trigger > now).
 *   3. Take the first ROLLING_WINDOW entries.
 *   4. Schedule each via expo-notifications using occurrenceId as identifier
 *      (idempotent: Expo replaces an existing slot with the same identifier).
 *
 * When hideOnLockScreen=true: notification title is the generic 'แจ้งเตือน'
 * rather than displayTitle (lock-screen privacy — SD-11).
 *
 * No-ops if permission is not granted.
 *
 * @param reminder  Active ReminderRecord with recurrenceRule + startAt
 * @param now       Optional override for "now" (used in tests)
 */
export async function scheduleReminderNotifications(
  reminder: ReminderRecord,
  now?: Date,
): Promise<void> {
  if (!(await hasGrantedPermission())) return;

  const nowDate = now ?? new Date();
  const today = localDateStr(nowDate);
  const windowEnd = addDaysCivil(today, ROLLING_WINDOW * 2);

  const civils = expand(
    { ...reminder.recurrenceRule, startAt: reminder.startAt },
    today,
    windowEnd,
  );

  const future = civils
    .map((c) => ({ civil: c, date: civilToLocalDate(c) }))
    .filter(({ date }) => date.getTime() > nowDate.getTime())
    .slice(0, ROLLING_WINDOW);

  await Promise.all(
    future.map(async ({ civil, date }) => {
      const occId = computeOccurrenceId(reminder.id, civil);
      const title = reminder.hideOnLockScreen ? 'แจ้งเตือน' : reminder.displayTitle;

      await Notifications.scheduleNotificationAsync({
        identifier: occId,
        content: {
          title,
          body: civil.slice(11, 16), // "HH:mm" display time
          data: {
            type: 'reminder',
            reminderId: reminder.id,
            occurrenceId: occId,
            scheduledLocalTime: civil,
          },
        },
        trigger: { date },
      });
    }),
  );
}

// ─── Schedule appointment notification ───────────────────────────────────────

/**
 * Schedule a single notification for a ChecklistItem appointment.
 *
 * Fires APPOINTMENT_LEAD_MS (30 min by default) before scheduledAt.
 * Uses item.id as the notification identifier → idempotent re-schedule
 * on update (Expo replaces the existing slot).
 *
 * Skips silently when:
 *   - scheduledAt is absent (undated tasks)
 *   - fireDate is in the past or within lead time of now
 *   - permission is not granted
 *
 * @param item  ChecklistItemRecord with category=appointment and scheduledAt
 * @param now   Optional override for "now" (used in tests)
 */
export async function scheduleAppointmentNotification(
  item: ChecklistItemRecord,
  now?: Date,
): Promise<void> {
  if (!item.scheduledAt) return;
  if (!(await hasGrantedPermission())) return;

  const apptDate = civilToLocalDate(item.scheduledAt);
  const fireDate = new Date(apptDate.getTime() - APPOINTMENT_LEAD_MS);
  const nowMs = (now ?? new Date()).getTime();
  if (fireDate.getTime() <= nowMs) return;

  await Notifications.scheduleNotificationAsync({
    identifier: item.id,
    content: {
      title: item.title,
      body: item.scheduledAt.slice(11, 16), // "HH:mm"
      data: {
        type: 'appointment',
        itemId: item.id,
        scheduledAt: item.scheduledAt,
      },
    },
    trigger: { date: fireDate },
  });
}

// ─── Cancel notifications ─────────────────────────────────────────────────────

/**
 * Cancel all scheduled notifications belonging to a reminder.
 *
 * Fetches the full scheduled list, filters by data.reminderId, and cancels
 * each match. Safe to call even if no notifications exist for this reminder.
 *
 * Call this when:
 *   - A reminder is deleted (enqueueDeleteReminder)
 *   - A reminder is updated (cancel then re-schedule)
 *   - A reminder is tombstoned from sync pull (reconcile handles this too)
 */
export async function cancelNotificationsForReminder(reminderId: string): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = all.filter(
    // 🟡-3: optional chaining — external notifications may have null/absent data
    (n) => n.content.data?.['reminderId'] === reminderId,
  );
  await Promise.all(
    toCancel.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Cancel a single reminder occurrence notification by its occurrenceId.
 *
 * Safe to call even if the notification has already fired or been cancelled
 * (expo-notifications treats unknown identifiers as no-ops).
 *
 * Call this when the user marks an occurrence as done or snoozes it from
 * within the app (CalendarScreen.handleOccurrenceAction).
 */
export async function cancelNotificationForOccurrence(occurrenceId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(occurrenceId);
}

/**
 * Cancel the scheduled notification for a ChecklistItem appointment.
 *
 * Safe to call even if the notification has already fired.
 *
 * Call this when:
 *   - An appointment is deleted
 *   - An appointment is marked done
 *   - An appointment is tombstoned from sync pull (reconcile handles this too)
 */
export async function cancelNotificationsForAppointment(itemId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(itemId);
}

// ─── Reconcile after sync pull ────────────────────────────────────────────────

/**
 * Reconcile scheduled OS notifications against the current store state.
 *
 * Call after calendarSyncStore is updated from a sync pull to keep the OS
 * scheduler in sync with server data.  Handles tombstoned reminders,
 * newly added reminders, updated appointment times, etc.
 *
 * Algorithm:
 *   1. Build expectedIds = set of identifiers that SHOULD be scheduled
 *      (ROLLING_WINDOW future occurrences for each active reminder +
 *       upcoming appointment fire-dates).
 *   2. Fetch currently scheduled notifications from the OS.
 *   3. Cancel any scheduled notification whose identifier is not in expectedIds.
 *   4. Schedule any expected identifier that is not yet in the OS scheduler.
 *
 * Idempotent — safe to call multiple times with the same inputs.
 * No-ops if permission is not granted.
 *
 * @param activeReminders    calendarSyncStore.getActiveReminders() (non-tombstoned)
 * @param activeAppointments calendarSyncStore.getActiveChecklistItems() (all, filtered here)
 * @param now                Optional override for "now" (used in tests)
 */
export async function reconcileNotifications(
  activeReminders: ReminderRecord[],
  activeAppointments: ChecklistItemRecord[],
  now?: Date,
): Promise<void> {
  if (!(await hasGrantedPermission())) return;

  const nowDate = now ?? new Date();
  const today = localDateStr(nowDate);
  const windowEnd = addDaysCivil(today, ROLLING_WINDOW * 2);

  // ── Build expected set and schedule plan ─────────────────────────────────

  const expectedIds = new Set<string>();

  type ReminderSlot = { reminder: ReminderRecord; civil: string; date: Date };
  type ApptSlot = { item: ChecklistItemRecord; fireDate: Date };

  const reminderSlots: ReminderSlot[] = [];
  const apptSlots: ApptSlot[] = [];

  for (const reminder of activeReminders) {
    if (!reminder.active) continue;
    const civils = expand(
      { ...reminder.recurrenceRule, startAt: reminder.startAt },
      today,
      windowEnd,
    );
    const future = civils
      .map((c) => ({ civil: c, date: civilToLocalDate(c) }))
      .filter(({ date }) => date.getTime() > nowDate.getTime())
      .slice(0, ROLLING_WINDOW);

    for (const { civil, date } of future) {
      const occId = computeOccurrenceId(reminder.id, civil);
      expectedIds.add(occId);
      reminderSlots.push({ reminder, civil, date });
    }
  }

  for (const appt of activeAppointments) {
    if (!appt.scheduledAt || appt.done) continue;
    const fireDate = new Date(civilToLocalDate(appt.scheduledAt).getTime() - APPOINTMENT_LEAD_MS);
    if (fireDate.getTime() > nowDate.getTime()) {
      expectedIds.add(appt.id);
      apptSlots.push({ item: appt, fireDate });
    }
  }

  // ── Fetch current OS state ────────────────────────────────────────────────

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledIds = new Set(scheduled.map((n) => n.identifier));

  // ── Cancel stale ──────────────────────────────────────────────────────────

  await Promise.all(
    scheduled
      .filter((n) => !expectedIds.has(n.identifier))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  // ── Schedule missing reminder occurrences ─────────────────────────────────

  await Promise.all(
    reminderSlots
      .filter(({ reminder, civil }) => {
        const occId = computeOccurrenceId(reminder.id, civil);
        return !scheduledIds.has(occId);
      })
      .map(async ({ reminder, civil, date }) => {
        const occId = computeOccurrenceId(reminder.id, civil);
        const title = reminder.hideOnLockScreen ? 'แจ้งเตือน' : reminder.displayTitle;
        await Notifications.scheduleNotificationAsync({
          identifier: occId,
          content: {
            title,
            body: civil.slice(11, 16),
            data: {
              type: 'reminder',
              reminderId: reminder.id,
              occurrenceId: occId,
              scheduledLocalTime: civil,
            },
          },
          trigger: { date },
        });
      }),
  );

  // ── Schedule missing appointment notifications ─────────────────────────────

  await Promise.all(
    apptSlots
      .filter(({ item }) => !scheduledIds.has(item.id))
      .map(async ({ item, fireDate }) => {
        await Notifications.scheduleNotificationAsync({
          identifier: item.id,
          content: {
            title: item.title,
            body: item.scheduledAt!.slice(11, 16),
            data: {
              type: 'appointment',
              itemId: item.id,
              scheduledAt: item.scheduledAt,
            },
          },
          trigger: { date: fireDate },
        });
      }),
  );
}
