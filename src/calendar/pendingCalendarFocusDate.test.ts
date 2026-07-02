/**
 * pendingCalendarFocusDate — unit tests (TDD).
 *
 * This module holds a module-level mutable slot for the calendar focus date.
 * Set on appointment/reminder save; consumed by CalendarScreen useFocusEffect.
 *
 * Invariants:
 *   1. consume() returns null when nothing is set.
 *   2. After set(date), consume() returns that date.
 *   3. consume() clears the slot (second call returns null — no double-apply).
 *   4. The last set() wins if called twice before consume().
 */

import {
  setPendingCalendarFocusDate,
  consumePendingCalendarFocusDate,
} from './pendingCalendarFocusDate';

// Reset module state between tests by consuming any leftover pending date.
beforeEach(() => {
  consumePendingCalendarFocusDate();
});

describe('pendingCalendarFocusDate', () => {
  it('returns null when nothing has been set', () => {
    expect(consumePendingCalendarFocusDate()).toBeNull();
  });

  it('returns the set date on first consume', () => {
    setPendingCalendarFocusDate('2026-08-15');
    expect(consumePendingCalendarFocusDate()).toBe('2026-08-15');
  });

  it('clears the slot after consume — second call returns null', () => {
    setPendingCalendarFocusDate('2026-08-15');
    consumePendingCalendarFocusDate();
    expect(consumePendingCalendarFocusDate()).toBeNull();
  });

  it('last set wins when called twice before consume', () => {
    setPendingCalendarFocusDate('2026-07-01');
    setPendingCalendarFocusDate('2026-09-20');
    expect(consumePendingCalendarFocusDate()).toBe('2026-09-20');
  });

  it('extracts civil date correctly from a scheduledAt string (YYYY-MM-DDTHH:mm)', () => {
    // Simulate what AppointmentFormScreen does: scheduledAt.slice(0, 10)
    const scheduledAt = '2026-11-03T14:30';
    setPendingCalendarFocusDate(scheduledAt.slice(0, 10));
    expect(consumePendingCalendarFocusDate()).toBe('2026-11-03');
  });
});
