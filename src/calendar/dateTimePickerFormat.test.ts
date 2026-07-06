/**
 * TDD tests for dateTimePickerFormat helpers.
 *
 * These helpers enable timezone-safe (floating-civil) round-trip between
 * the app's "YYYY-MM-DD" / "HH:mm" string formats and Date objects required
 * by DateTimePicker.
 *
 * Key invariant: all conversions use LOCAL date/time components, never UTC,
 * so a "YYYY-MM-DD" string can never shift to an adjacent day regardless of
 * the device's UTC offset or DST transitions.
 */

import {
  toCivilDate,
  toCivilTime,
  parseCivilDate,
  parseCivilTime,
} from './dateTimePickerFormat';
import { localCivilToday } from '../pregnancy/gestationalAge';

// ─── toCivilDate ─────────────────────────────────────────────────────────────

describe('toCivilDate', () => {
  it('formats a regular date', () => {
    // local midnight on 2026-06-15
    const d = new Date(2026, 5, 15); // month is 0-indexed
    expect(toCivilDate(d)).toBe('2026-06-15');
  });

  it('zero-pads month and day below 10', () => {
    const d = new Date(2026, 0, 5); // Jan 5
    expect(toCivilDate(d)).toBe('2026-01-05');
  });

  it('handles year boundary (Dec 31)', () => {
    const d = new Date(2025, 11, 31); // Dec 31 2025
    expect(toCivilDate(d)).toBe('2025-12-31');
  });

  it('handles year boundary (Jan 1)', () => {
    const d = new Date(2026, 0, 1); // Jan 1 2026
    expect(toCivilDate(d)).toBe('2026-01-01');
  });

  it('uses LOCAL date components — not UTC — so midnight is always the intended day', () => {
    // Create local midnight on the target day; the civil date must match.
    // UTC midnight would differ by TZ offset, but we must read LOCAL components.
    const target = '2026-03-29'; // a DST-transition day in many TZs
    const d = new Date(2026, 2, 29, 0, 0, 0); // local midnight
    expect(toCivilDate(d)).toBe(target);
  });
});

// ─── toCivilTime ─────────────────────────────────────────────────────────────

describe('toCivilTime', () => {
  it('formats a regular time', () => {
    const d = new Date();
    d.setHours(9, 30, 0, 0);
    expect(toCivilTime(d)).toBe('09:30');
  });

  it('zero-pads hours and minutes below 10', () => {
    const d = new Date();
    d.setHours(8, 5, 0, 0);
    expect(toCivilTime(d)).toBe('08:05');
  });

  it('formats midnight (00:00)', () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    expect(toCivilTime(d)).toBe('00:00');
  });

  it('formats last minute of day (23:59)', () => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    expect(toCivilTime(d)).toBe('23:59');
  });

  it('ignores seconds and milliseconds', () => {
    const d = new Date();
    d.setHours(14, 7, 45, 999);
    expect(toCivilTime(d)).toBe('14:07');
  });
});

// ─── parseCivilDate ───────────────────────────────────────────────────────────

describe('parseCivilDate', () => {
  it('parses a regular date string into local midnight', () => {
    const d = parseCivilDate('2026-06-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed June
    expect(d.getDate()).toBe(15);
  });

  it('parses zero-padded month and day correctly', () => {
    const d = parseCivilDate('2026-01-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(5);
  });

  it('sets time components to local midnight', () => {
    const d = parseCivilDate('2026-07-01');
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

// ─── parseCivilTime ───────────────────────────────────────────────────────────

describe('parseCivilTime', () => {
  it('parses a regular time string', () => {
    const d = parseCivilTime('09:30');
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('parses midnight (00:00)', () => {
    const d = parseCivilTime('00:00');
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('parses last minute of day (23:59)', () => {
    const d = parseCivilTime('23:59');
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });
});

// ─── Round-trip invariants ────────────────────────────────────────────────────

describe('round-trip: toCivilDate(parseCivilDate(s)) === s', () => {
  const cases = [
    '2026-01-01',
    '2026-06-15',
    '2026-12-31',
    '2025-02-28',
    '2026-03-29', // DST transition day in many TZs
    '2026-10-25', // DST end day in many TZs
  ];

  for (const s of cases) {
    it(`round-trips ${s}`, () => {
      expect(toCivilDate(parseCivilDate(s))).toBe(s);
    });
  }
});

// ─── DEF-01: blank-date OFF state guard (ANC_PREFILL_DATE=OFF) ───────────────
//
// When ANC_PREFILL_DATE=OFF, initAppointmentFormState returns date=''.
// parseCivilDate('') produces Invalid Date — it does not validate its input.
//
// FIX applied in AppointmentFormScreen:
//   openDatePicker(): setTempPickerDate(parseCivilDate(date || localCivilToday()))
//   Android value:    value={parseCivilDate(date || localCivilToday())}
//   Date field:       date ? formatCivilDate(date, locale) : t('appointment.datePlaceholder')
//
// These tests guard the fix: the second test asserts the || fallback pattern
// produces a valid today-Date, matching how the call sites now behave.

describe('parseCivilDate — empty string guard (DEF-01, blank-date OFF state)', () => {
  it('parseCivilDate("") produces Invalid Date — callers MUST guard with || localCivilToday()', () => {
    // parseCivilDate does not validate its input; empty string produces Invalid Date.
    // This documents WHY the || localCivilToday() fallback is required at call sites.
    const result = parseCivilDate('');
    expect(isNaN(result.getTime())).toBe(true);
  });

  it('DEF-01 fix: parseCivilDate(date || localCivilToday()) with blank date produces valid local-midnight today', () => {
    // Guards the fix: openDatePicker() and Android value both use this fallback pattern.
    // Simulates the runtime call with a blank date variable (not a constant '').
    const blankDate = '' as string; // typed as string so the || branch is reachable
    const todayStr = localCivilToday();
    const result = parseCivilDate(blankDate || todayStr);
    expect(isNaN(result.getTime())).toBe(false);
    const today = new Date();
    expect(result.getFullYear()).toBe(today.getFullYear());
    expect(result.getMonth()).toBe(today.getMonth());
    expect(result.getDate()).toBe(today.getDate());
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });
});

describe('round-trip: toCivilTime(parseCivilTime(s)) === s', () => {
  const cases = [
    '00:00',
    '08:05',
    '09:30',
    '12:00',
    '14:07',
    '23:59',
  ];

  for (const s of cases) {
    it(`round-trips ${s}`, () => {
      expect(toCivilTime(parseCivilTime(s))).toBe(s);
    });
  }
});
