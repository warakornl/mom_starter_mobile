export type OccStatus = 'due' | 'done' | 'snoozed' | 'missed';

/**
 * The per-day cell indicator. `allHandledSnoozed` renders the crescent (not the
 * done stamp) — a day handled purely by snoozing must never imply completion.
 */
export type DayIndicator =
  | 'missed'
  | 'due'
  | 'allHandled'
  | 'allHandledSnoozed'
  | 'loggedOnly'
  | 'none';

/**
 * Per-day indicator precedence: missed > due > all-handled > logged-only > none.
 * (design-system §5.5/§6, spec §3.5).
 */
export function computeDayIndicator(
  occurrenceStatuses: OccStatus[],
  hasLoggedEntries: boolean,
): DayIndicator {
  if (occurrenceStatuses.includes('missed')) return 'missed';
  if (occurrenceStatuses.includes('due')) return 'due';

  if (occurrenceStatuses.length > 0) {
    // remaining statuses are all done/snoozed (missed & due handled above)
    const anyDone = occurrenceStatuses.some((s) => s === 'done');
    return anyDone ? 'allHandled' : 'allHandledSnoozed';
  }

  return hasLoggedEntries ? 'loggedOnly' : 'none';
}
