/**
 * notificationScheduler — pure, unit-testable core logic for the on-device
 * notification firing layer (ADR Decision 2, functional spec §1).
 *
 * This module contains ZERO native calls. All expo-notifications interaction
 * is delegated to the NotificationsAdapter interface (notificationsAdapter.ts),
 * which is mocked in tests and wired to the real library in production.
 *
 * Architecture:
 *   scheduleUpcoming(reminders, excludedIds, now, adapter)
 *     → expand all active reminders within the rolling window
 *     → sort soonest-first, cap at PENDING_BUDGET
 *     → request permission (non-fatal if declined)
 *     → schedule each occurrence via adapter
 *
 *   cancelForOccurrence(occurrenceId, adapter)
 *     → cancel one OS notification by its deterministic id
 *
 *   reanchor(reminders, excludedIds, now, adapter)
 *     → get current OS scheduled ids
 *     → build new target set
 *     → cancel stale (in OS but not in new set)
 *     → schedule new set (idempotent replace via same id)
 *
 * Rolling window (ADR "Bounding rule"):
 *   WINDOW_DAYS   = 7  (FLAG-5 tunable default)
 *   PENDING_BUDGET = 60 (shared across ALL reminder types, headroom under iOS hard-64)
 *
 * Occurrence id (ADR Decision 2 "Idempotency"):
 *   Each OS notification uses the deterministic uuidv5 occurrence id as its
 *   identifier — computed by computeOccurrenceId(reminderId, scheduledLocalTime).
 *   Scheduling the same id twice is a no-op replace (no duplicate alarms).
 *
 * Security (SD-11 + ADR Decision 4):
 *   MEDICATION_TITLE_TH / _EN are the ONLY strings ever placed in notification
 *   content for medication reminders. Drug name/dose NEVER appears in a notification
 *   payload. displayTitle on the ReminderRecord is a generic label ("ยา"); it is
 *   NOT used as the lock-screen title (the fixed constant is).
 *
 * PRN/no-schedule plans: They produce no linked Reminder (Task 1 / US-17), so
 *   they never appear in the reminders array passed to this module.
 *
 * iOS coverage-window limitation (ADR Decision 2 "Coverage-window edge"):
 *   The effective firing guarantee on iOS is min(WINDOW_DAYS, budget-drain-time).
 *   A high-frequency plan can drain the 60-slot pool before the 7-day horizon —
 *   later occurrences silently do not fire until the app is re-foregrounded.
 *   This is an accepted, explicitly tracked QA limitation (Task 6 launch-gate).
 */

import { expand } from '../recurrence/recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import type { ReminderRecord } from '../sync/syncTypes';
import type { NotificationsAdapter } from './notificationsAdapter';

// ─── Constants (ADR Decision 2 FLAG-5 tunables) ───────────────────────────────

/** Default rolling-window horizon in days (FLAG-5 tunable). */
export const WINDOW_DAYS = 7;

/**
 * Shared per-app pending notification budget (headroom under iOS hard-64 cap).
 * Allocated soonest-fire-first across ALL reminder types. (ADR Decision 2)
 */
export const PENDING_BUDGET = 60;

/**
 * Generic lock-screen title for medication reminders (SD-11).
 * NEVER replaced with drug name or dose.
 *
 * A locale-aware variant would require threading a `locale` param through
 * buildScheduleSet(). That is deferred — add it in the i18n task if needed.
 * There is intentionally no English-fallback constant here; it was dead code
 * (the scheduler always emits TH). Remove MEDICATION_TITLE_EN rather than
 * leaving a constant that implies wired i18n when it is not.
 */
export const MEDICATION_TITLE_TH = 'ถึงเวลากินยา';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single occurrence entry ready for OS scheduling. */
export interface ScheduleEntry {
  /** Deterministic uuidv5 occurrence id (used as the OS notification identifier). */
  occurrenceId: string;
  /** Parent Reminder.id. */
  reminderId: string;
  /** Floating-civil "YYYY-MM-DDTHH:mm" — the exact hash input from the expander. */
  scheduledLocalTime: string;
  /** Absolute Date at which the OS should fire the notification (local TZ). */
  fireAt: Date;
  /** Lock-screen/banner title — always the generic constant for medication. */
  title: string;
}

// ─── Civil → absolute fire-instant conversion ─────────────────────────────────

/**
 * Convert a floating-civil "YYYY-MM-DDTHH:mm" string to an absolute Unix ms
 * using the DEVICE'S current local timezone (new Date(y, m-1, d, h, min)).
 *
 * This is the re-anchoring step: the same civil string maps to different absolute
 * instants in different timezones. Called on every reanchor() to move fire
 * instants when the device timezone changes (ADR Decision 2 / §1.3 MR-E15).
 *
 * NOTE: scheduledLocalTime and the occurrence id are NEVER changed; only the
 * fire instant (this ms value) moves. (FLAG-1: B.6/N6-N7 — civil bucket fixed.)
 */
export function civilToFireAtMs(scheduledLocalTime: string): number {
  const [datePart, timePart] = scheduledLocalTime.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  // Local constructor (NOT Date.UTC) — uses device TZ
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

// ─── Civil date helpers ───────────────────────────────────────────────────────

/** Format a local Date as "YYYY-MM-DD" civil string (device TZ). */
function toCivilDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add `n` civil days to a "YYYY-MM-DD" string (UTC-safe day arithmetic). */
function addCivilDays(isoDate: string, n: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ─── Core: build the schedule set ─────────────────────────────────────────────

/**
 * Build the set of occurrences to be scheduled as OS notifications.
 *
 * Pure function — no side effects, no native calls. Accepts all reminders
 * (any type); budget is shared across all types (soonest-first).
 *
 * Task 5 update — snoozedUntilMap:
 *   For snoozed occurrences (approach A), the caller passes a map of
 *   occurrenceId → snoozedUntil Date (built via buildSnoozedUntilMap).
 *   When an occurrence id appears in the map:
 *     - If snoozedUntil > now: schedule at snoozedUntil (not the original civil time)
 *     - If snoozedUntil ≤ now: skip (alarm already fired/missed)
 *   This ensures reanchor() keeps the snooze alarm alive across foreground
 *   transitions without ever scheduling two alarms for the same occurrence.
 *
 * @param reminders       All ReminderRecords (active + inactive; function filters)
 * @param excludedIds     Set of occurrence ids done (not to re-schedule)
 * @param now             Current local wall-clock time
 * @param windowDays      Rolling-window horizon in civil days (default: WINDOW_DAYS)
 * @param budget          Max pending notifications across all types (default: PENDING_BUDGET)
 * @param snoozedUntilMap Map of occurrenceId → future snoozedUntil Date (Task 5)
 * @returns               ScheduleEntry[], sorted soonest-first, capped at budget
 */
export function buildScheduleSet(
  reminders: ReminderRecord[],
  excludedIds: ReadonlySet<string>,
  now: Date,
  windowDays: number = WINDOW_DAYS,
  budget: number = PENDING_BUDGET,
  snoozedUntilMap: ReadonlyMap<string, Date> = new Map(),
): ScheduleEntry[] {
  const windowStart = toCivilDate(now);
  const windowEnd = addCivilDays(windowStart, windowDays);
  const nowMs = now.getTime();

  const all: ScheduleEntry[] = [];

  for (const reminder of reminders) {
    // Skip inactive or tombstoned reminders
    if (!reminder.active || reminder.deletedAt) continue;

    // Expand the recurrence rule over the rolling window
    // recurrenceExpander.expand requires `startAt` on the rule object;
    // build a compatible RecurrenceRule from the wire type + reminder.startAt
    const rule = {
      freq: reminder.recurrenceRule.freq,
      interval: reminder.recurrenceRule.interval,
      timesOfDay: reminder.recurrenceRule.timesOfDay,
      byDay: reminder.recurrenceRule.byDay as string[] | undefined,
      startAt: reminder.startAt,
      until: reminder.recurrenceRule.until,
    };

    let civilTimes: string[];
    try {
      civilTimes = expand(rule, windowStart, windowEnd);
    } catch {
      // Malformed rule — skip gracefully (never crash the scheduler)
      continue;
    }

    // Determine notification title (SD-11: medication always uses generic constant)
    const title =
      reminder.type === 'medication' ? MEDICATION_TITLE_TH : reminder.displayTitle;

    for (const scheduledLocalTime of civilTimes) {
      // Compute the deterministic occurrence id first (needed for snoozedUntilMap lookup)
      const occurrenceId = computeOccurrenceId(reminder.id, scheduledLocalTime);

      // Skip done occurrences (terminal; MR-AC-11)
      if (excludedIds.has(occurrenceId)) continue;

      // Task 5 — snoozed occurrence: schedule at snoozedUntil instead of original civil time.
      // The original scheduledLocalTime is in the past for a snoozed occurrence, so we must
      // check the snooze map BEFORE applying the fireAtMs <= nowMs filter.
      if (snoozedUntilMap.has(occurrenceId)) {
        const snoozedFireAt = snoozedUntilMap.get(occurrenceId)!;
        if (snoozedFireAt.getTime() > nowMs) {
          // Snooze alarm is in the future — schedule at snoozedUntil
          all.push({
            occurrenceId,
            reminderId: reminder.id,
            scheduledLocalTime,
            fireAt: snoozedFireAt,
            title,
          });
        }
        // Past snoozedUntil → skip (alarm already fired/missed)
        continue;
      }

      // Normal case: use original scheduled civil time
      const fireAtMs = civilToFireAtMs(scheduledLocalTime);

      // Only schedule future occurrences (strictly after now)
      if (fireAtMs <= nowMs) continue;

      all.push({
        occurrenceId,
        reminderId: reminder.id,
        scheduledLocalTime,
        fireAt: new Date(fireAtMs),
        title,
      });
    }
  }

  // Sort soonest-fire-first across ALL reminder types (shared budget allocation)
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

  // Cap at the shared pending budget
  return all.slice(0, budget);
}

// ─── scheduleSnooze ───────────────────────────────────────────────────────────

/**
 * Schedule exactly one OS notification for a snoozed occurrence at snoozedUntil.
 *
 * Called immediately when the user picks a snooze duration (10/30/60 min) so the
 * alarm is set right away (no waiting for the next reanchor). Scheduling the same
 * occurrence id at a new time is an OS-level idempotent replace — re-snooze calls
 * this function a second time with a new snoozedUntil, which replaces the first
 * pending alarm (never two alarms per occurrence — MR-E11 / INV-MR-5).
 *
 * SD-11 compliance: the title parameter MUST be the generic constant
 * MEDICATION_TITLE_TH for medication occurrences (never the drug name).
 * For non-medication, pass the reminder's displayTitle.
 *
 * Permission-declined is NON-FATAL (spec §1.5 / §2.4): the snoozed status and
 * snoozedUntil are already written to the store by the caller; if permission is
 * absent, the snooze is a calendar/data fact only — no OS alarm fires.
 *
 * @param occurrenceId  Deterministic uuidv5 occurrence id (OS notification id)
 * @param snoozedUntil  Absolute Date at which the snooze alarm should fire
 * @param title         Lock-screen/banner title (SD-11: generic constant for medication)
 * @param adapter       NotificationsAdapter (real or mock)
 */
export async function scheduleSnooze(
  occurrenceId: string,
  snoozedUntil: Date,
  title: string,
  adapter: NotificationsAdapter,
): Promise<void> {
  // 1. Request permission — non-fatal if declined
  let granted = false;
  try {
    const result = await adapter.requestPermissionsAsync();
    granted = result.granted;
  } catch {
    // Permission check failed — treat as declined (non-fatal)
    granted = false;
  }

  if (!granted) return;

  // 2. Schedule the snooze alarm (same id replaces any existing pending alarm)
  try {
    await adapter.scheduleAsync(occurrenceId, title, '', snoozedUntil);
  } catch {
    // Individual scheduling failure is non-fatal — snoozedUntil is still in the store
  }
}

// ─── scheduleUpcoming ─────────────────────────────────────────────────────────

/**
 * Schedule OS notifications for all near-term medication (and other type)
 * occurrences within the rolling window.
 *
 * Permission flow (ADR Decision 1 / functional spec §1.5):
 *   Requests POST_NOTIFICATIONS / iOS permission politely. Declined is NON-FATAL:
 *   nothing is scheduled, no error is thrown, and in-app calendar projection is
 *   unaffected (that's the store/UI layer, not this module).
 *
 * Idempotency: scheduling the same occurrence id twice is an OS-level no-op replace.
 *
 * @param reminders       All active ReminderRecords
 * @param excludedIds     Occurrence ids to skip (done)
 * @param now             Current wall-clock time
 * @param adapter         NotificationsAdapter (real or mock)
 * @param snoozedUntilMap occurrenceId → snoozedUntil Date for active snoozed occurrences (Task 5)
 */
export async function scheduleUpcoming(
  reminders: ReminderRecord[],
  excludedIds: ReadonlySet<string>,
  now: Date,
  adapter: NotificationsAdapter,
  snoozedUntilMap: ReadonlyMap<string, Date> = new Map(),
): Promise<void> {
  // 1. Request permission (non-fatal if declined)
  let granted = false;
  try {
    const result = await adapter.requestPermissionsAsync();
    granted = result.granted;
  } catch {
    // Permission check failed — treat as declined (non-fatal)
    granted = false;
  }

  if (!granted) return;

  // 2. Build the schedule set (includes snoozed at their snoozedUntil)
  const entries = buildScheduleSet(reminders, excludedIds, now, WINDOW_DAYS, PENDING_BUDGET, snoozedUntilMap);

  // 3. Schedule each entry (non-fatal per-entry errors)
  for (const entry of entries) {
    try {
      await adapter.scheduleAsync(
        entry.occurrenceId,
        entry.title,
        '', // body is generic (empty); extended details shown in-app after unlock
        entry.fireAt,
      );
    } catch {
      // Individual scheduling failure is non-fatal — continue with the rest
    }
  }
}

// ─── cancelForOccurrence ──────────────────────────────────────────────────────

/**
 * Cancel the pending OS notification for a single occurrence.
 * Called immediately when a user marks an occurrence done or snoozed
 * (resolves CalendarScreen.tsx:485 TODO and §3.4 of the functional spec).
 *
 * Non-fatal: if the OS notification was already delivered or never scheduled,
 * cancelAsync is a no-op (expo-notifications ignores unknown ids).
 *
 * @param occurrenceId Deterministic uuidv5 occurrence id (the OS notification id)
 * @param adapter      NotificationsAdapter
 */
export async function cancelForOccurrence(
  occurrenceId: string,
  adapter: NotificationsAdapter,
): Promise<void> {
  try {
    await adapter.cancelAsync(occurrenceId);
  } catch {
    // Cancel failure is non-fatal — the notification may have already fired
  }
}

// ─── reanchor ─────────────────────────────────────────────────────────────────

/**
 * Re-materialize the rolling-window schedule on a re-anchor trigger.
 *
 * Re-anchor triggers (ADR Decision 2 / functional spec §1.3):
 *   - App foreground (primary)
 *   - Boot / BOOT_COMPLETED (Android — requires native BOOT_COMPLETED receiver)
 *   - Timezone change (fires floating-civil times at new absolute instants)
 *
 * Algorithm:
 *   1. Get all currently scheduled OS notification ids
 *   2. Build the new target schedule set (includes snoozed at snoozedUntil)
 *   3. Cancel any ids in the current OS set that are NOT in the new target (stale)
 *   4. Schedule all ids in the new target (idempotent replace — same id = replace)
 *
 * The cancel-then-schedule pattern is safe because scheduling the same id
 * replaces the existing alarm (ADR Decision 2 "Idempotency").
 *
 * Task 5: snoozedUntilMap is now threaded through so snoozed occurrences are
 * rescheduled at their snoozedUntil on every re-anchor pass (not cancelled as
 * stale). This implements approach A: the scheduler is the single source of
 * truth for both normal and snoozed OS alarms.
 *
 * Permission: re-requested on each reanchor (user may have changed it in Settings).
 * Stale cancellation happens regardless of permission (cleanup is always safe).
 *
 * @param reminders       All ReminderRecords (active + tombstoned; function filters)
 * @param excludedIds     Occurrence ids to skip (done occurrences)
 * @param now             Current wall-clock time (device local)
 * @param adapter         NotificationsAdapter
 * @param snoozedUntilMap occurrenceId → snoozedUntil Date for active snoozed occurrences (Task 5)
 */
export async function reanchor(
  reminders: ReminderRecord[],
  excludedIds: ReadonlySet<string>,
  now: Date,
  adapter: NotificationsAdapter,
  snoozedUntilMap: ReadonlyMap<string, Date> = new Map(),
): Promise<void> {
  // 1. Get currently scheduled OS notification ids
  let currentIds: string[] = [];
  try {
    currentIds = await adapter.getAllScheduledIdsAsync();
  } catch {
    // getAllScheduledIdsAsync failure is non-fatal — proceed with empty baseline
    currentIds = [];
  }

  // 2. Build the new target schedule set (snoozed occurrences at snoozedUntil)
  const entries = buildScheduleSet(reminders, excludedIds, now, WINDOW_DAYS, PENDING_BUDGET, snoozedUntilMap);
  const targetIdSet = new Set(entries.map((e) => e.occurrenceId));

  // 3. Cancel stale notifications (in OS but not in the new target)
  for (const id of currentIds) {
    if (!targetIdSet.has(id)) {
      try {
        await adapter.cancelAsync(id);
      } catch {
        // Non-fatal
      }
    }
  }

  // 4. Schedule new set (permission check inside scheduleUpcoming)
  await scheduleUpcoming(reminders, excludedIds, now, adapter, snoozedUntilMap);
}
