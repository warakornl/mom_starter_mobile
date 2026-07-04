/**
 * snoozeRouterLogic.test.ts — TDD tests for the CalendarScreen snooze routing.
 *
 * Minor 4: locking the routing rules so regressions are caught:
 *   - medication + any status → 'chooser' (10/30/60 SnoozeChooserSheet)
 *   - non-medication + not-yet-snoozed → 'fixed1h' (immediate 1h no chooser),
 *     carrying the occurrence's displayTitle for the OS alarm
 *   - non-medication + already-snoozed → 'none' (snooze option not offered)
 *
 * All logic is pure — no React, no native calls.
 */

import {
  resolveSnoozeRoute,
  type SnoozeRoute,
} from './snoozeRouterLogic';
import type { ReminderType, OccurrenceStatus } from '../sync/syncTypes';

const MED: ReminderType    = 'medication';
const APPT: ReminderType   = 'appointment';
const KICK: ReminderType   = 'kick_count';
const FEED: ReminderType   = 'feeding';
const SUPPLY: ReminderType = 'supply_restock';
const CUSTOM: ReminderType = 'custom';

const DUE: OccurrenceStatus     = 'due';
const SNOOZED: OccurrenceStatus = 'snoozed';
const MISSED: OccurrenceStatus  = 'missed';

// ─── medication → chooser ──────────────────────────────────────────────────────

describe('resolveSnoozeRoute — medication type', () => {
  it('medication + due → chooser', () => {
    const route = resolveSnoozeRoute(MED, DUE, 'ยา');
    expect(route.action).toBe('chooser');
  });

  it('medication + snoozed → chooser (re-snooze allowed for medication)', () => {
    // spec §2.1: medication can be re-snoozed, no chooser gating on snoozed status
    const route = resolveSnoozeRoute(MED, SNOOZED, 'ยา');
    expect(route.action).toBe('chooser');
  });

  it('medication + missed → chooser', () => {
    const route = resolveSnoozeRoute(MED, MISSED, 'ยา');
    expect(route.action).toBe('chooser');
  });

  it('chooser route does NOT carry a displayTitle (sheet needs none)', () => {
    const route = resolveSnoozeRoute(MED, DUE, 'ยาสมุนไพร');
    // chooser route has action only; no displayTitle leaking drug label
    expect(route.action).toBe('chooser');
    if (route.action === 'chooser') {
      // SnoozeRoute discriminated union: 'chooser' has no displayTitle field
      // TypeScript ensures this at compile time; runtime: property should be absent
      expect((route as { displayTitle?: string }).displayTitle).toBeUndefined();
    }
  });
});

// ─── non-medication → fixed1h or none ─────────────────────────────────────────

describe('resolveSnoozeRoute — non-medication types', () => {
  it('appointment + due → fixed1h, passes displayTitle', () => {
    const route = resolveSnoozeRoute(APPT, DUE, 'นัดฝากครรภ์');
    expect(route.action).toBe('fixed1h');
    if (route.action === 'fixed1h') {
      expect(route.displayTitle).toBe('นัดฝากครรภ์');
    }
  });

  it('kick_count + due → fixed1h', () => {
    const route = resolveSnoozeRoute(KICK, DUE, 'นับลูกดิ้น');
    expect(route.action).toBe('fixed1h');
  });

  it('feeding + due → fixed1h', () => {
    const route = resolveSnoozeRoute(FEED, DUE, 'นมแม่');
    expect(route.action).toBe('fixed1h');
  });

  it('supply_restock + due → fixed1h', () => {
    const route = resolveSnoozeRoute(SUPPLY, DUE, 'เติมของ');
    expect(route.action).toBe('fixed1h');
  });

  it('custom + due → fixed1h', () => {
    const route = resolveSnoozeRoute(CUSTOM, DUE, 'เตือนกำหนดเอง');
    expect(route.action).toBe('fixed1h');
  });

  it('appointment + missed → fixed1h (missed non-medication can be snoozed)', () => {
    const route = resolveSnoozeRoute(APPT, MISSED, 'นัดฝากครรภ์');
    expect(route.action).toBe('fixed1h');
  });

  it('non-medication + snoozed → none (spec §2.3: re-snooze not offered for non-med)', () => {
    // Non-medication occurrences that are already snoozed do NOT show a snooze option.
    // spec §2.3 / CalendarScreen Alert routing: snoze offered only when not already snoozed.
    const route = resolveSnoozeRoute(APPT, SNOOZED, 'นัดฝากครรภ์');
    expect(route.action).toBe('none');
  });

  it('kick_count + snoozed → none', () => {
    expect(resolveSnoozeRoute(KICK, SNOOZED, 'นับลูกดิ้น').action).toBe('none');
  });

  it('feeding + snoozed → none', () => {
    expect(resolveSnoozeRoute(FEED, SNOOZED, 'นมแม่').action).toBe('none');
  });
});

// ─── displayTitle threading ────────────────────────────────────────────────────

describe('resolveSnoozeRoute — displayTitle in fixed1h result', () => {
  it('fixed1h route carries the exact displayTitle passed in', () => {
    const title = 'นัดพบแพทย์ 15:00';
    const route = resolveSnoozeRoute(APPT, DUE, title);
    expect(route.action).toBe('fixed1h');
    if (route.action === 'fixed1h') {
      expect(route.displayTitle).toBe(title);
    }
  });

  it('none route does not carry a displayTitle', () => {
    const route = resolveSnoozeRoute(APPT, SNOOZED, 'ชื่อ');
    expect(route.action).toBe('none');
    if (route.action === 'none') {
      expect((route as { displayTitle?: string }).displayTitle).toBeUndefined();
    }
  });
});
