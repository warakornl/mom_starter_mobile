/**
 * snoozeChooserLogic.test.ts — unit tests for the snooze chooser pure logic.
 *
 * Tests cover:
 *   - computeSnoozedUntil: each of 10/30/60 minutes returns now + N min (MR-AC-6)
 *   - isMedicationReminder: routing decision — medication → chooser, others → fixed 1h
 *   - formatSnoozeTime: HH:mm formatting for alertsAt sub-label
 *   - getSnoozeOptions: returns the three options with correct alertsAt times
 *
 * All functions are pure (no native/device calls) — safe to run in Jest/Node.
 */

import {
  computeSnoozedUntil,
  isMedicationReminder,
  formatSnoozeTime,
  getSnoozeOptions,
} from './snoozeChooserLogic';
import type { ReminderType } from '../sync/syncTypes';

const NOW = new Date(2026, 6, 4, 12, 0, 0, 0); // 2026-07-04T12:00:00 local

// ─── computeSnoozedUntil ─────────────────────────────────────────────────────

describe('computeSnoozedUntil', () => {
  it('10 minutes: snoozedUntil = now + 10 min', () => {
    const result = computeSnoozedUntil(10, NOW);
    expect(result.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
  });

  it('30 minutes: snoozedUntil = now + 30 min', () => {
    const result = computeSnoozedUntil(30, NOW);
    expect(result.getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);
  });

  it('60 minutes: snoozedUntil = now + 60 min', () => {
    const result = computeSnoozedUntil(60, NOW);
    expect(result.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  it('returns a Date (not a number or string)', () => {
    expect(computeSnoozedUntil(10, NOW)).toBeInstanceOf(Date);
  });
});

// ─── isMedicationReminder ─────────────────────────────────────────────────────

describe('isMedicationReminder', () => {
  it('returns true for type "medication"', () => {
    expect(isMedicationReminder('medication' as ReminderType)).toBe(true);
  });

  it('returns false for type "kick_count"', () => {
    expect(isMedicationReminder('kick_count' as ReminderType)).toBe(false);
  });

  it('returns false for type "feeding"', () => {
    expect(isMedicationReminder('feeding' as ReminderType)).toBe(false);
  });

  it('returns false for type "appointment"', () => {
    expect(isMedicationReminder('appointment' as ReminderType)).toBe(false);
  });

  it('returns false for type "supply_restock"', () => {
    expect(isMedicationReminder('supply_restock' as ReminderType)).toBe(false);
  });

  it('returns false for type "custom"', () => {
    expect(isMedicationReminder('custom' as ReminderType)).toBe(false);
  });
});

// ─── formatSnoozeTime ────────────────────────────────────────────────────────

describe('formatSnoozeTime', () => {
  it('formats 12:05 as "12:05" (zero-padded minutes)', () => {
    const d = new Date(2026, 6, 4, 12, 5, 0, 0);
    expect(formatSnoozeTime(d)).toBe('12:05');
  });

  it('formats 08:00 as "08:00" (zero-padded hour)', () => {
    const d = new Date(2026, 6, 4, 8, 0, 0, 0);
    expect(formatSnoozeTime(d)).toBe('08:00');
  });

  it('formats 23:59 as "23:59"', () => {
    const d = new Date(2026, 6, 4, 23, 59, 0, 0);
    expect(formatSnoozeTime(d)).toBe('23:59');
  });

  it('formats 00:00 as "00:00"', () => {
    const d = new Date(2026, 6, 5, 0, 0, 0, 0);
    expect(formatSnoozeTime(d)).toBe('00:00');
  });
});

// ─── getSnoozeOptions ────────────────────────────────────────────────────────

describe('getSnoozeOptions', () => {
  it('returns three options: 10, 30, 60', () => {
    const opts = getSnoozeOptions(NOW);
    expect(opts).toHaveLength(3);
    expect(opts.map(o => o.minutes)).toEqual([10, 30, 60]);
  });

  it('each option has alertsAt = now + minutes', () => {
    const opts = getSnoozeOptions(NOW);
    expect(opts[0].alertsAt.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
    expect(opts[1].alertsAt.getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);
    expect(opts[2].alertsAt.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  it('each option includes a formatted alertsAtStr (HH:mm)', () => {
    const opts = getSnoozeOptions(NOW);
    // NOW = 12:00, so 10 min → 12:10, 30 → 12:30, 60 → 13:00
    expect(opts[0].alertsAtStr).toBe('12:10');
    expect(opts[1].alertsAtStr).toBe('12:30');
    expect(opts[2].alertsAtStr).toBe('13:00');
  });
});
