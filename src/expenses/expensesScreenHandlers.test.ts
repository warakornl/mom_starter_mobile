/**
 * expensesScreenHandlers — TDD test suite (failing tests written first).
 *
 * Covers the pure handler functions extracted from ExpensesScreen to make
 * money and date logic directly unit-testable:
 *
 *   filterAmountInput()     — decimal-aware amount input filter
 *   satangToInputString()   — 2-dp baht string for edit field population
 *   isValidCivilDate()      — YYYY-MM-DD format + calendar validity guard
 *
 * Money path invariants (the bugs these tests catch):
 *   "59.90" → 5990 satang (decimal NOT stripped before util sees it)
 *   "60"    → 6000 satang (whole number OK)
 *   5990 satang in edit → repopulates as "59.90" (no rounding loss)
 *   5990 satang save → 5990 satang (round-trip preserves 10 satang)
 */

import {
  filterAmountInput,
  satangToInputString,
  isValidCivilDate,
} from './expensesScreenHandlers';
import { bahtStringToSatang } from './expensesUtils';

// ─── filterAmountInput ────────────────────────────────────────────────────────

describe('filterAmountInput', () => {
  it('allows digits with no decimal — "60" stays "60"', () => {
    expect(filterAmountInput('60')).toBe('60');
  });

  it('allows a decimal point — "59.90" stays "59.90"', () => {
    expect(filterAmountInput('59.90')).toBe('59.90');
  });

  it('allows 1 decimal place — "59.9" stays "59.9"', () => {
    expect(filterAmountInput('59.9')).toBe('59.9');
  });

  it('truncates to 2 decimal places — "59.905" becomes "59.90"', () => {
    expect(filterAmountInput('59.905')).toBe('59.90');
  });

  it('strips non-numeric characters — "abc" becomes ""', () => {
    expect(filterAmountInput('abc')).toBe('');
  });

  it('strips commas — "1,200" becomes "1200"', () => {
    expect(filterAmountInput('1,200')).toBe('1200');
  });

  it('only keeps first decimal point — "5.9.0" becomes "5.90"', () => {
    expect(filterAmountInput('5.9.0')).toBe('5.90');
  });

  it('handles empty string', () => {
    expect(filterAmountInput('')).toBe('');
  });

  it('handles leading decimal — ".90" stays ".90"', () => {
    expect(filterAmountInput('.90')).toBe('.90');
  });

  it('allows whole number with no trailing decimal — "5990" stays "5990"', () => {
    expect(filterAmountInput('5990')).toBe('5990');
  });
});

// ─── satangToInputString ──────────────────────────────────────────────────────

describe('satangToInputString', () => {
  it('converts 5990 satang to "59.90" (₿59.90, not "60")', () => {
    expect(satangToInputString(5990)).toBe('59.90');
  });

  it('converts 6000 satang to "60.00"', () => {
    expect(satangToInputString(6000)).toBe('60.00');
  });

  it('converts 100 satang (฿1) to "1.00"', () => {
    expect(satangToInputString(100)).toBe('1.00');
  });

  it('converts 0 satang to "0.00"', () => {
    expect(satangToInputString(0)).toBe('0.00');
  });

  it('converts 1234567 satang to "12345.67"', () => {
    expect(satangToInputString(1234567)).toBe('12345.67');
  });

  it('converts 59000 satang (฿590) to "590.00"', () => {
    expect(satangToInputString(59000)).toBe('590.00');
  });
});

// ─── Round-trip precision tests (the core money bug) ─────────────────────────

describe('amount round-trip precision', () => {
  it('"59.90" → filterAmountInput → bahtStringToSatang → 5990 satang (no precision loss)', () => {
    const filtered = filterAmountInput('59.90');
    const satang = bahtStringToSatang(filtered);
    expect(satang).toBe(5990);
  });

  it('"60" → filterAmountInput → bahtStringToSatang → 6000 satang', () => {
    const filtered = filterAmountInput('60');
    const satang = bahtStringToSatang(filtered);
    expect(satang).toBe(6000);
  });

  it('edit of 5990-satang row repopulates "59.90" and saves back 5990 (no loss)', () => {
    // Edit: 5990 satang → input field
    const inputValue = satangToInputString(5990);
    expect(inputValue).toBe('59.90');

    // Save: "59.90" → satang (must be 5990, not 5900 or 6000)
    const filtered = filterAmountInput(inputValue);
    const savedSatang = bahtStringToSatang(filtered);
    expect(savedSatang).toBe(5990);
  });

  it('edit of 6000-satang row repopulates "60.00" and saves back 6000', () => {
    const inputValue = satangToInputString(6000);
    expect(inputValue).toBe('60.00');

    const savedSatang = bahtStringToSatang(filterAmountInput(inputValue));
    expect(savedSatang).toBe(6000);
  });

  it('edit of 1-satang row preserves sub-baht precision (1 satang round-trip)', () => {
    const inputValue = satangToInputString(1);
    const savedSatang = bahtStringToSatang(filterAmountInput(inputValue));
    expect(savedSatang).toBe(1);
  });
});

// ─── isValidCivilDate ─────────────────────────────────────────────────────────

describe('isValidCivilDate', () => {
  it('accepts a valid date "2026-07-01"', () => {
    expect(isValidCivilDate('2026-07-01')).toBe(true);
  });

  it('accepts "2026-01-01" (first day of year)', () => {
    expect(isValidCivilDate('2026-01-01')).toBe(true);
  });

  it('accepts "2026-12-31" (last day of year)', () => {
    expect(isValidCivilDate('2026-12-31')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidCivilDate('')).toBe(false);
  });

  it('rejects "abc"', () => {
    expect(isValidCivilDate('abc')).toBe(false);
  });

  it('rejects month 0 — "2026-00-01"', () => {
    expect(isValidCivilDate('2026-00-01')).toBe(false);
  });

  it('rejects month 13 — "2026-13-01"', () => {
    expect(isValidCivilDate('2026-13-01')).toBe(false);
  });

  it('rejects day 0 — "2026-07-00"', () => {
    expect(isValidCivilDate('2026-07-00')).toBe(false);
  });

  it('rejects day 32 — "2026-07-32"', () => {
    expect(isValidCivilDate('2026-07-32')).toBe(false);
  });

  it('rejects non-zero-padded month "2026-7-1"', () => {
    expect(isValidCivilDate('2026-7-1')).toBe(false);
  });

  it('rejects partial date "2026-07"', () => {
    expect(isValidCivilDate('2026-07')).toBe(false);
  });

  it('rejects date with spaces', () => {
    expect(isValidCivilDate('2026 07 01')).toBe(false);
  });
});
