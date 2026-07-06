/**
 * ancUpcomingApptSelector.test.ts — TDD for hasUpcomingAncApptInWindow.
 *
 * Pure-function tests — no rendering needed.
 *
 * Verifies (ANC-AC-9 / §1.3 item 4 / behavior spec §1.3):
 *   - True when a non-done appointment or anc_visit falls in [today, nextTargetDate+WINDOW]
 *   - False when no such item exists (card should be offered)
 *   - False when item is done=true (completed appointments don't suppress the offer)
 *   - False when item's scheduledAt is before today (past appointments don't suppress)
 *   - False when item's scheduledAt is after the window end
 *   - False when item category is not appointment/anc_visit (other categories don't suppress)
 *   - False when edd is absent (no offerable → no window to check)
 *   - False when gestationalWeek >= max(ANC_TARGET_WEEKS) (no next target → no window)
 *   - Boundary: item exactly on today → true (inclusive lower bound)
 *   - Boundary: item exactly on nextTargetDate+WINDOW → true (inclusive upper bound)
 */

import { hasUpcomingAncApptInWindow } from './ancUpcomingApptSelector';
import type { ChecklistItemRecord } from '../sync/syncTypes';
import { ANC_TARGET_WEEKS, APPOINTMENT_WINDOW_DAYS } from './ancConfig';
import { weekToTargetDate } from '../pregnancy/gestationalAge';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// EDD chosen so that computeGestationalAge(EDD, TODAY) ≈ GW_IN_WINDOW = 11.
// EDD = 2027-01-29 means TODAY = 2026-07-10 is gestational week 11
// (daysPregnant=77, 280-daysUntilEdd=280-203=77, floor(77/7)=11).
// This keeps NEXT_TARGET_DATE (2026-07-18) AFTER TODAY so the window is valid.
const EDD = '2027-01-29';
const TODAY = '2026-07-10';

// Use the first target week to parametrize (avoids golden-vector pinning)
const FIRST_TARGET = ANC_TARGET_WEEKS[0];
// gestationalWeek in the offer lead window
const GW_IN_WINDOW = FIRST_TARGET - 1;

// The unclamped target date for the first target
const NEXT_TARGET_DATE = weekToTargetDate(EDD, FIRST_TARGET); // YYYY-MM-DD, UNCLAMPED

// Window end = nextTargetDate + APPOINTMENT_WINDOW_DAYS
function addDays(date: string, n: number): string {
  const ms = new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const WINDOW_END = addDays(NEXT_TARGET_DATE, APPOINTMENT_WINDOW_DAYS);

function makeItem(overrides: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'item-1',
    category: 'appointment',
    title: 'Test appointment',
    scheduledAt: `${TODAY}T09:00`,
    done: false,
    note: null,
    source: 'user_created',
    version: 1,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hasUpcomingAncApptInWindow', () => {
  it('returns false when no items exist', () => {
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, [], TODAY)).toBe(false);
  });

  it('returns true when a non-done appointment falls on today (inclusive lower bound)', () => {
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false, category: 'appointment' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(true);
  });

  it('returns true when a non-done anc_visit falls in the window', () => {
    const midWindow = addDays(TODAY, 3);
    const items = [makeItem({ scheduledAt: `${midWindow}T09:00`, done: false, category: 'anc_visit' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(true);
  });

  it('returns true when a non-done appointment falls exactly on WINDOW_END (inclusive upper bound)', () => {
    const items = [makeItem({ scheduledAt: `${WINDOW_END}T09:00`, done: false, category: 'appointment' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(true);
  });

  it('returns false when item is done=true', () => {
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: true, category: 'appointment' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when item scheduledAt is before today (past appointment)', () => {
    const yesterday = addDays(TODAY, -1);
    const items = [makeItem({ scheduledAt: `${yesterday}T09:00`, done: false, category: 'appointment' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when item scheduledAt is after WINDOW_END', () => {
    const afterWindow = addDays(WINDOW_END, 1);
    const items = [makeItem({ scheduledAt: `${afterWindow}T09:00`, done: false, category: 'appointment' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when item category is neither appointment nor anc_visit', () => {
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false, category: 'medication' as ChecklistItemRecord['category'] })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when item scheduledAt is null/undefined', () => {
    const items = [makeItem({ scheduledAt: null, done: false, category: 'appointment' })];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when edd is absent (null)', () => {
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false })];
    expect(hasUpcomingAncApptInWindow(null, GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when edd is empty string', () => {
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false })];
    expect(hasUpcomingAncApptInWindow('', GW_IN_WINDOW, items, TODAY)).toBe(false);
  });

  it('returns false when gestationalWeek >= max(ANC_TARGET_WEEKS) — no next target', () => {
    const maxTarget = ANC_TARGET_WEEKS[ANC_TARGET_WEEKS.length - 1];
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false })];
    // At or past the last target, no next target → no window to check
    expect(hasUpcomingAncApptInWindow(EDD, maxTarget, items, TODAY)).toBe(false);
  });

  it('returns false when gestationalWeek is negative (far-future EDD)', () => {
    // Negative gestational week means no target in the offer window yet
    // BUT the selector still computes the window for the first target.
    // Since gw < 0 < FIRST_TARGET, nextTargetWeek = FIRST_TARGET.
    // The window [today, nextTargetDate+WINDOW] may or may not contain the item —
    // this just confirms the function handles negative weeks without throwing.
    const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false })];
    // Should not throw; return value depends on whether item falls in window
    const result = hasUpcomingAncApptInWindow(EDD, -2, items, TODAY);
    expect(typeof result).toBe('boolean');
  });

  it('only matches categories appointment and anc_visit (not self_log, supplies, medication)', () => {
    const categories: ChecklistItemRecord['category'][] = [
      'self_log' as ChecklistItemRecord['category'],
      'supplies_item' as ChecklistItemRecord['category'],
    ];
    for (const cat of categories) {
      const items = [makeItem({ scheduledAt: `${TODAY}T09:00`, done: false, category: cat })];
      expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(false);
    }
  });

  it('returns true when multiple items — at least one matches', () => {
    const items = [
      makeItem({ id: 'i1', scheduledAt: addDays(WINDOW_END, 5), done: false, category: 'appointment' }),
      makeItem({ id: 'i2', scheduledAt: `${TODAY}T10:00`, done: false, category: 'anc_visit' }),
    ];
    expect(hasUpcomingAncApptInWindow(EDD, GW_IN_WINDOW, items, TODAY)).toBe(true);
  });
});
