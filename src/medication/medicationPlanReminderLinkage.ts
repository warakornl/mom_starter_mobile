/**
 * medicationPlanReminderLinkage — pure linkage logic for Plan → Reminder.
 *
 * When a medication plan is created / edited / deactivated / tombstoned, the
 * caller invokes the appropriate `apply*Linkage` function to keep the linked
 * `Reminder` row in sync with the plan's lifecycle.
 *
 * ## Why pure / dependency-injected?
 *   Same philosophy as `medicationPlanFormLogic.ts`: keep all decision logic
 *   in pure functions that can be unit-tested without React Native, stores, or
 *   timers.  The only external dependency is a minimal `CalendarReminderStore`
 *   interface (satisfied by the real `calendarSyncStore` at runtime, by a stub
 *   in tests).
 *
 * ## PRIVACY — ADR Decision 4 (BINDING)
 *   `displayTitle` is stored PLAINTEXT on the server and returned by
 *   `GET /reminders`. Copying the drug name there would create a SECOND,
 *   UNENCRYPTED copy of SD-2 (drug name) outside the `name_cipher` encrypted
 *   path — violating field-encryption, crypto-shred, erasure, and export
 *   handling AND the field's own "non-sensitive" contract
 *   (`syncTypes.ts:145-147`).
 *   → `displayTitle` MUST be the constant `MEDICATION_REMINDER_DISPLAY_TITLE`.
 *   → The real drug name is resolved IN-APP from `sourceRefId → medication_plan`
 *     (decrypt `name_cipher` on-device) at render time — never stored here.
 *
 * ## PRN plans
 *   A plan with `scheduleRule === null` is PRN (ad-hoc).  PRN plans MUST NOT
 *   create a linked reminder; they remain manually loggable only.
 *
 * ## LWW lifecycle
 *   Plan active=false  → linked reminder active=false (enqueueUpdateReminder).
 *   Plan PRN (edit)    → linked reminder deleted     (enqueueDeleteReminder).
 *   Plan tombstoned    → linked reminder deleted     (enqueueDeleteReminder).
 *   Plan PRN→scheduled → linked reminder created     (enqueueCreateReminder).
 *
 * Security:
 *   - NEVER set displayTitle to any derivation of plan.name or plan.dose (SD-2).
 *   - Do NOT log plan.name, plan.dose, or plan.scheduleRule (SD-2/SD-5).
 *
 * Governs: Slice-3 Task 1 (plan→reminder linkage).
 * MR-AC-1: scheduled plan → Reminder{type:'medication', sourceRefType:'medication_plan'}.
 * MR-AC-14: deactivate/delete → cancel alarms + stop future occurrences.
 */

import { v4 as uuidv4 } from 'uuid';
import type { MedicationPlan, ReminderRecord, RecurrenceRuleWire } from '../sync/syncTypes';

// ─── Generic non-sensitive displayTitle (ADR Decision 4 + SD-11) ──────────────

/**
 * The single generic, non-sensitive label used as `displayTitle` for ALL
 * medication-linked reminders (never the drug name — ADR Decision 4, BINDING).
 *
 * This string is safe to store plaintext on the server and to show on the lock
 * screen (SD-11) without revealing any health-sensitive content.  The real drug
 * name + dose is resolved client-side from `sourceRefId → medication_plan`
 * (decrypt `name_cipher` on-device) at render time.
 */
export const MEDICATION_REMINDER_DISPLAY_TITLE = 'การเตือนกินยา';

// ─── Minimal store interface (dependency-injection boundary) ──────────────────

/**
 * CalendarReminderStore — the subset of CalendarSyncStore methods that the
 * linkage logic needs.  Using a minimal interface instead of the concrete store
 * keeps the module pure and unit-testable with a simple stub.
 *
 * Satisfied by `calendarSyncStore` at runtime and by a plain-object stub in tests.
 */
export interface CalendarReminderStore {
  /** Active (non-tombstoned) reminders.  Used to look up a linked reminder. */
  getActiveReminders(): ReminderRecord[];
  /** Enqueue a new reminder for creation on next sync/push. */
  enqueueCreateReminder(item: ReminderRecord): void;
  /** Enqueue an update to an existing reminder for sync/push. */
  enqueueUpdateReminder(item: ReminderRecord): void;
  /** Enqueue deletion (tombstone) of a reminder for sync/push. */
  enqueueDeleteReminder(id: string): void;
}

// ─── buildLinkedReminder — pure mapping ───────────────────────────────────────

/**
 * Build a ReminderRecord linked to a medication plan.
 *
 * Returns `null` for PRN plans (`scheduleRule === null`) — PRN plans generate
 * NO linked reminder (design §5.1, MR-AC-1, US-17).
 *
 * PRIVACY (ADR Decision 4): `displayTitle` is ALWAYS the generic constant
 * `MEDICATION_REMINDER_DISPLAY_TITLE`, NEVER any derivation of `plan.name`
 * or `plan.dose`.  The drug name is resolved in-app from `sourceRefId`.
 *
 * The plan's `scheduleRule` is a valid `RecurrenceRuleWire` (medication is a
 * strict subset of the FLAG-4 grammar) — copy verbatim, no transform.
 * `startAt` is extracted from `scheduleRule.startAt` and set on the record.
 *
 * @param plan       The medication plan record (must be a non-tombstone row).
 * @param reminderId UUIDv4 to assign as the reminder's id (caller-generated).
 * @param now        ISO-8601 UTC instant for createdAt / updatedAt.
 */
export function buildLinkedReminder(
  plan: MedicationPlan,
  reminderId: string,
  now: string,
): ReminderRecord | null {
  // PRN / null-schedule → no reminder (US-17, design §5.1)
  if (!plan.scheduleRule) {
    return null;
  }

  const { scheduleRule } = plan;

  // Copy the MedicationScheduleRule verbatim as the RecurrenceRuleWire.
  // MedicationScheduleRule is a structural subset of RecurrenceRuleWire
  // (same required `freq`; no `byDay`; extra `startAt` property is harmless
  // and retained for the expander's benefit).  Do NOT transform.
  const recurrenceRule: RecurrenceRuleWire = scheduleRule as RecurrenceRuleWire;

  return {
    id: reminderId,
    type: 'medication',
    // PRIVACY: ALWAYS the generic constant — NEVER plan.name / plan.dose (SD-2).
    displayTitle: MEDICATION_REMINDER_DISPLAY_TITLE,
    hideOnLockScreen: true,
    sourceRefType: 'medication_plan',
    sourceRefId: plan.id,
    recurrenceRule,
    // startAt is folded INTO MedicationScheduleRule (unlike generic reminders
    // where it lives as a separate field); extract it here.
    startAt: scheduleRule.startAt,
    active: plan.active,
    // Create sentinel — server assigns version ≥ 1 on first apply.
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ─── findLinkedReminder — lookup helper ───────────────────────────────────────

/**
 * Find the reminder linked to a given medication plan, if it exists.
 *
 * Searches the store's active (non-tombstoned) reminders for one with
 * `sourceRefId === planId`.  Returns `undefined` when no linked reminder exists
 * (e.g., PRN plan that was never given a reminder, or already tombstoned).
 *
 * Note: `getActiveReminders()` returns non-tombstoned reminders including
 * deactivated ones (active=false), so deactivated linked reminders are found.
 *
 * @param planId       The medication plan's id to search for.
 * @param calendarStore The store to query.
 */
export function findLinkedReminder(
  planId: string,
  calendarStore: CalendarReminderStore,
): ReminderRecord | undefined {
  return calendarStore
    .getActiveReminders()
    .find((r) => r.sourceRefType === 'medication_plan' && r.sourceRefId === planId);
}

// ─── applyPlanCreateLinkage ───────────────────────────────────────────────────

/**
 * Lifecycle hook — call after a medication plan is created.
 *
 * If the plan has a recurrence schedule, emits a linked reminder via
 * `enqueueCreateReminder`.  PRN plans (null `scheduleRule`) are silently
 * skipped — no reminder is created.
 *
 * @param plan          The freshly-created medication plan record.
 * @param calendarStore The calendar store to enqueue into.
 * @param now           ISO-8601 UTC instant (passed for testability).
 */
export function applyPlanCreateLinkage(
  plan: MedicationPlan,
  calendarStore: CalendarReminderStore,
  now: string,
): void {
  // PRN — no reminder (US-17)
  if (!plan.scheduleRule) return;

  const reminder = buildLinkedReminder(plan, uuidv4(), now);
  if (reminder) {
    calendarStore.enqueueCreateReminder(reminder);
  }
}

// ─── applyPlanUpdateLinkage ───────────────────────────────────────────────────

/**
 * Lifecycle hook — call after a medication plan is updated (edit, deactivate,
 * or schedule change).
 *
 * Decision table:
 *   - Scheduled plan + existing reminder → enqueueUpdateReminder (recurrenceRule
 *     + active + startAt follow the plan; displayTitle stays generic).
 *   - Scheduled plan + NO existing reminder → enqueueCreateReminder
 *     (PRN→scheduled transition: MR-E5).
 *   - PRN plan (null schedule_rule) + existing reminder → enqueueDeleteReminder
 *     (scheduled→PRN transition: MR-E4).
 *   - PRN plan + NO existing reminder → no-op (already PRN, nothing to clean up).
 *
 * LWW: the plan update drives the reminder update; updatedAt on the emitted
 * reminder is set to `now` (matching the plan's updated timestamp posture).
 *
 * @param plan          The updated medication plan record.
 * @param calendarStore The calendar store to enqueue into.
 * @param now           ISO-8601 UTC instant.
 */
export function applyPlanUpdateLinkage(
  plan: MedicationPlan,
  calendarStore: CalendarReminderStore,
  now: string,
): void {
  const existing = findLinkedReminder(plan.id, calendarStore);

  if (!plan.scheduleRule) {
    // Plan is now PRN (or was deactivated with no schedule)
    if (existing) {
      // Delete the orphaned reminder (MR-E4: scheduled → PRN transition)
      calendarStore.enqueueDeleteReminder(existing.id);
    }
    // No existing reminder → nothing to do (PRN stayed PRN)
    return;
  }

  // Plan has a schedule
  if (!existing) {
    // PRN → scheduled transition (MR-E5): create a new linked reminder
    const newReminder = buildLinkedReminder(plan, uuidv4(), now);
    if (newReminder) {
      calendarStore.enqueueCreateReminder(newReminder);
    }
    return;
  }

  // Update the existing reminder to follow the plan's current state
  const updated: ReminderRecord = {
    ...existing,
    // Verbatim copy of the (possibly changed) recurrenceRule
    recurrenceRule: plan.scheduleRule as RecurrenceRuleWire,
    startAt: plan.scheduleRule.startAt,
    // Active mirrors the plan (handles deactivate: MR-E6)
    active: plan.active,
    // PRIVACY: always keep the generic title — never copy plan.name (SD-2)
    displayTitle: MEDICATION_REMINDER_DISPLAY_TITLE,
    updatedAt: now,
  };

  calendarStore.enqueueUpdateReminder(updated);
}

// ─── applyPlanTombstoneLinkage ────────────────────────────────────────────────

/**
 * Lifecycle hook — call when a medication plan is tombstoned (soft-deleted).
 *
 * Pushes TWO tombstones: the plan (handled by medicationPlanSyncStore) and the
 * linked reminder (handled here via `enqueueDeleteReminder`).  This mirrors the
 * `supply_restock`↔`supply_item` two-tombstone pattern (ADR Decision 3).
 *
 * No server FK cascade — the client is responsible for both deletes (MR-E7).
 * Past acted occurrences and taken logs are retained as adherence history.
 *
 * If no linked reminder exists (PRN plan), this is a no-op.
 *
 * @param planId        The id of the tombstoned medication plan.
 * @param calendarStore The calendar store to enqueue into.
 */
export function applyPlanTombstoneLinkage(
  planId: string,
  calendarStore: CalendarReminderStore,
): void {
  const existing = findLinkedReminder(planId, calendarStore);
  if (existing) {
    calendarStore.enqueueDeleteReminder(existing.id);
  }
}
