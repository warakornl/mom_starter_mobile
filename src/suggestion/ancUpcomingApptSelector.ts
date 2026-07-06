/**
 * ancUpcomingApptSelector.ts — ANC offerable §1.3 item 4 wiring helper.
 *
 * Pure function: given the current checklistItems from calendarSyncStore,
 * the EDD, and the current gestationalWeek, returns true iff a non-done
 * appointment or anc_visit exists in [today, nextTargetDate + WINDOW].
 *
 * Called at the wiring layer (RootNavigator) and the boolean result is
 * passed into SuggestionFlowScreen as `upcomingApptInWindow`.
 *
 * INV-A1: inputs are non-sensitive civil dates + category metadata only.
 *   No symptom, vital, lab, or risk value enters this predicate.
 *
 * Window definition (§1.3 item 4 / §9-F4):
 *   lower bound = today (inclusive) — never treat past appointments as "upcoming"
 *   upper bound = nextTargetDate + APPOINTMENT_WINDOW_DAYS (inclusive)
 */

import type { ChecklistItemRecord } from '../sync/syncTypes';
import { ANC_TARGET_WEEKS, APPOINTMENT_WINDOW_DAYS } from './ancConfig';
import { weekToTargetDate, localCivilToday, parseCivilDateMs } from '../pregnancy/gestationalAge';

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Returns true iff the mother has at least one non-done appointment or
 * anc_visit ChecklistItem with scheduledAt in [today, nextTargetDate + WINDOW].
 *
 * Returns false when:
 *   - edd is absent (null | undefined | '')
 *   - gestationalWeek >= max(ANC_TARGET_WEEKS) — no next target, no window
 *   - no matching item exists
 *
 * @param edd               EDD as civil 'YYYY-MM-DD'; falsy → return false
 * @param gestationalWeek   Current gestational week (may be negative)
 * @param items             Active (non-tombstoned) ChecklistItemRecords from calendarSyncStore
 * @param today             Optional override for today (YYYY-MM-DD); defaults to localCivilToday()
 */
export function hasUpcomingAncApptInWindow(
  edd: string | null | undefined,
  gestationalWeek: number,
  items: ChecklistItemRecord[],
  today?: string,
): boolean {
  // Guard: EDD required to compute the window
  if (!edd) return false;

  // nextTargetWeek = smallest target strictly > gestationalWeek
  const nextTargetWeek = ANC_TARGET_WEEKS.find((w) => w > gestationalWeek);
  if (nextTargetWeek === undefined) return false; // past last target → no window

  const todayStr = today ?? localCivilToday();
  const todayMs = parseCivilDateMs(todayStr);

  // Compute nextTargetDate (UNCLAMPED)
  const nextTargetDate = weekToTargetDate(edd, nextTargetWeek);
  const windowEndMs = parseCivilDateMs(nextTargetDate) + APPOINTMENT_WINDOW_DAYS * 86_400_000;

  return items.some((item) => {
    // Category gate: only appointment and anc_visit count (§1.3 item 4)
    if (item.category !== 'appointment' && item.category !== 'anc_visit') return false;
    // Done gate: completed appointments don't suppress the offer
    if (item.done) return false;
    // scheduledAt required
    if (!item.scheduledAt) return false;

    // Extract civil date from scheduledAt (format: "YYYY-MM-DDTHH:mm" or similar)
    const itemMs = parseCivilDateMs(item.scheduledAt.slice(0, 10));

    // Window: [today, nextTargetDate + WINDOW] inclusive on both ends
    return itemMs >= todayMs && itemMs <= windowEndMs;
  });
}
