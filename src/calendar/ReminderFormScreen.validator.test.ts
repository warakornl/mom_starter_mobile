/**
 * ReminderFormScreen — validateRecurrenceRule unit tests (FLAG-4 grammar).
 *
 * Tests the EXTENDED validator that includes the new `byDay` parameter and
 * 'weekly' freq support (recurrence-weekly-byday-design.md §3).
 *
 * The validator is a strict subset of the server 422 rules so a passing client
 * form is guaranteed never to produce a server-side 422 validation_error.
 *
 * TDD: these tests are written BEFORE the implementation to lock the contract.
 */
import { validateRecurrenceRule } from './reminderFormValidator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OK_START = '2026-07-01T08:00';
const OK_TIMES = ['08:00'];

function valid(
  freq: string,
  interval: string,
  timesOfDay: string[],
  until: string,
  startAt: string,
  byDay: string[],
) {
  return validateRecurrenceRule(freq, interval, timesOfDay, until, startAt, byDay);
}

// ─── Existing freqs still pass (backward compat) ───────────────────────────────

describe('validateRecurrenceRule — existing freqs (backward compat)', () => {
  it('one_off with no extras passes', () => {
    expect(valid('one_off', '', [], '', OK_START, [])).toEqual([]);
  });

  it('daily with timesOfDay passes', () => {
    expect(valid('daily', '', OK_TIMES, '', OK_START, [])).toEqual([]);
  });

  it('every_n_days with interval passes', () => {
    expect(valid('every_n_days', '3', OK_TIMES, '', OK_START, [])).toEqual([]);
  });
});

// ─── byDay FORBIDDEN on non-weekly freqs ──────────────────────────────────────

describe('validateRecurrenceRule — byDay forbidden on non-weekly freqs', () => {
  it('byDay on one_off is rejected (field=byDay)', () => {
    const errors = valid('one_off', '', [], '', OK_START, ['MO']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('byDay on daily is rejected (field=byDay)', () => {
    const errors = valid('daily', '', OK_TIMES, '', OK_START, ['TU']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('byDay on every_n_days is rejected (field=byDay)', () => {
    const errors = valid('every_n_days', '2', OK_TIMES, '', OK_START, ['WE']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });
});

// ─── weekly requires non-empty canonical byDay ────────────────────────────────

describe('validateRecurrenceRule — weekly byDay rules', () => {
  it('weekly with valid byDay passes', () => {
    expect(valid('weekly', '', OK_TIMES, '', OK_START, ['MO', 'WE', 'FR'])).toEqual([]);
  });

  it('weekly with single day passes', () => {
    expect(valid('weekly', '', OK_TIMES, '', OK_START, ['WE'])).toEqual([]);
  });

  it('weekly with empty byDay is rejected (field=byDay)', () => {
    const errors = valid('weekly', '', OK_TIMES, '', OK_START, []);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('weekly with invalid token is rejected (field=byDay)', () => {
    const errors = valid('weekly', '', OK_TIMES, '', OK_START, ['MON']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('weekly with integer-style token is rejected (field=byDay)', () => {
    const errors = valid('weekly', '', OK_TIMES, '', OK_START, ['1']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('weekly with duplicate token is rejected (field=byDay)', () => {
    const errors = valid('weekly', '', OK_TIMES, '', OK_START, ['MO', 'MO']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('weekly with out-of-order byDay is rejected (field=byDay)', () => {
    // MO<WE<TU is wrong order (should be MO<TU<WE)
    const errors = valid('weekly', '', OK_TIMES, '', OK_START, ['MO', 'WE', 'TU']);
    expect(errors.some((e) => e.field === 'byDay')).toBe(true);
  });

  it('weekly without timesOfDay is rejected (field=timesOfDay)', () => {
    const errors = valid('weekly', '', [], '', OK_START, ['MO']);
    expect(errors.some((e) => e.field === 'timesOfDay')).toBe(true);
  });

  it('weekly with interval=1 passes', () => {
    expect(valid('weekly', '1', OK_TIMES, '', OK_START, ['MO'])).toEqual([]);
  });

  it('weekly with interval=52 passes (cap boundary)', () => {
    expect(valid('weekly', '52', OK_TIMES, '', OK_START, ['MO'])).toEqual([]);
  });

  it('weekly with interval=53 is rejected (field=interval)', () => {
    const errors = valid('weekly', '53', OK_TIMES, '', OK_START, ['MO']);
    expect(errors.some((e) => e.field === 'interval')).toBe(true);
  });

  it('weekly with interval=0 is rejected (field=interval)', () => {
    const errors = valid('weekly', '0', OK_TIMES, '', OK_START, ['MO']);
    expect(errors.some((e) => e.field === 'interval')).toBe(true);
  });

  it('weekly with all 7 days in canonical order passes (OQ-4: server accepts)', () => {
    expect(
      valid('weekly', '', OK_TIMES, '', OK_START, ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']),
    ).toEqual([]);
  });

  it('weekly with SA and SU passes', () => {
    expect(valid('weekly', '', OK_TIMES, '', OK_START, ['SA', 'SU'])).toEqual([]);
  });
});

// ─── until FORBIDDEN on one_off (server rejects; client must mirror) ─────────

describe('validateRecurrenceRule — until forbidden for one_off', () => {
  it('one_off with until set is rejected (field=until)', () => {
    const errors = valid('one_off', '', [], '2026-08-01', OK_START, []);
    expect(errors.some((e) => e.field === 'until')).toBe(true);
  });

  it('one_off with empty until still passes', () => {
    expect(valid('one_off', '', [], '', OK_START, [])).toEqual([]);
  });

  it('daily with until set still passes (only one_off is forbidden)', () => {
    expect(valid('daily', '', OK_TIMES, '2026-08-01', OK_START, [])).toEqual([]);
  });

  it('weekly with until set still passes (only one_off is forbidden)', () => {
    expect(valid('weekly', '', OK_TIMES, '2026-08-01', OK_START, ['MO'])).toEqual([]);
  });
});

// ─── unknown freq still rejected ─────────────────────────────────────────────

describe('validateRecurrenceRule — unknown freq', () => {
  it('unknown freq is rejected (field=freq)', () => {
    const errors = valid('monthly', '', OK_TIMES, '', OK_START, []);
    expect(errors.some((e) => e.field === 'freq')).toBe(true);
  });
});
