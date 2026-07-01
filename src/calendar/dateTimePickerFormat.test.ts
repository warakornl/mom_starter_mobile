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
