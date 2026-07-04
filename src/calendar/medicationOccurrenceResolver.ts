/**
 * medicationOccurrenceResolver — pure, unit-testable in-app title resolver.
 *
 * ## SD-11 in-app half (ADR Decision 4 / design §5.3)
 *
 * The synced Reminder row carries a GENERIC `displayTitle` ("การเตือนกินยา")
 * that is safe to store plaintext on the server (no SD-2 drug-name leak).
 *
 * The in-app calendar occurrence row (Day-Detail) must show the REAL drug name
 * + dose, resolved client-side from `sourceRefId → medication_plan` by
 * decoding `name_cipher` on-device.  This module implements that resolution.
 *
 * ## Privacy / security invariant
 *   - This resolver is ONLY used for in-app (post-unlock) display.
 *   - Drug name/dose MUST NEVER flow into a notification payload.
 *   - The caller (CalendarScreen) passes `medicationPlanSyncStore.getPlans()`
 *     indexed by id — no network call, no async, pure function.
 *
 * ## Fallback (OQ-CAL-6)
 *   If the parent plan is tombstoned (`deletedAt` present) or not found in
 *   the local map, the resolver falls back to `reminder.displayTitle` (the
 *   generic label) — gracefully degraded, not an error.
 *
 * ## Non-medication reminders
 *   Reminders whose `type !== 'medication'` are returned verbatim
 *   (`{title: reminder.displayTitle, dose: null}`).
 *
 * Security: NEVER log `title` or `dose` returned by this function (MOTHER-health SD-2).
 */

import type { ReminderRecord, MedicationPlan } from '../sync/syncTypes';
import { decodeFieldFromBase64 } from '../capture/captureScreenLogic';

// ─── Return type ──────────────────────────────────────────────────────────────

/**
 * Resolution result for an in-app occurrence row.
 *
 * `title` — the drug name decoded from the linked medication plan, or the
 *            generic displayTitle when the plan is unavailable.
 * `dose`  — the decoded dose string, or null when absent/unavailable.
 *
 * Security: NEVER log these fields (MOTHER-health SD-2).
 */
export interface MedicationOccurrenceResolution {
  title: string;
  dose: string | null;
}

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the in-app display title + dose for a reminder occurrence.
 *
 * Algorithm:
 *   1. Non-medication reminder → return {title: reminder.displayTitle, dose: null}.
 *   2. sourceRefType !== 'medication_plan' or sourceRefId absent → fallback.
 *   3. Look up `sourceRefId` in `plansById`.
 *   4. Plan not found or tombstoned → fallback.
 *   5. Decode `plan.name` → title; decode `plan.dose` → dose (null if absent).
 *   6. Fallback: {title: reminder.displayTitle, dose: null}.
 *
 * Pure function — no side effects, no store access, no async.
 *
 * @param reminder  The ReminderRecord for the occurrence's parent reminder.
 * @param plansById Map<planId, MedicationPlan> from medicationPlanSyncStore.
 * @returns         {title, dose} for in-app display (never for notification payloads).
 *
 * Security: NEVER use the return value in a notification payload (SD-11).
 *   Only use this for in-app display AFTER device unlock.
 */
export function resolveMedicationOccurrenceTitle(
  reminder: ReminderRecord,
  plansById: ReadonlyMap<string, MedicationPlan>,
): MedicationOccurrenceResolution {
  const fallback: MedicationOccurrenceResolution = {
    title: reminder.displayTitle,
    dose: null,
  };

  // Non-medication reminders: return displayTitle verbatim
  if (reminder.type !== 'medication') {
    return fallback;
  }

  // Must have medication_plan sourceRef with a valid sourceRefId
  if (
    reminder.sourceRefType !== 'medication_plan' ||
    !reminder.sourceRefId
  ) {
    return fallback;
  }

  // Look up the plan
  const plan = plansById.get(reminder.sourceRefId);
  if (!plan) {
    // Plan not found in local map → graceful degradation (OQ-CAL-6)
    return fallback;
  }

  // Tombstoned plan → graceful degradation (OQ-CAL-6)
  if (plan.deletedAt) {
    return fallback;
  }

  // Decode the drug name from base64 ciphertext (SD-2 on-device decryption)
  // decodeFieldFromBase64 returns null for null/empty input
  const decodedName = decodeFieldFromBase64(plan.name);
  if (!decodedName) {
    // Crypto-shredded or empty name_cipher → fallback
    return fallback;
  }

  // Decode the dose (optional — null when absent)
  const decodedDose = decodeFieldFromBase64(plan.dose ?? null);

  return {
    title: decodedName,
    dose: decodedDose,
  };
}
