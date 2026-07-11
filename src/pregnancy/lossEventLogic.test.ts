/**
 * lossEventLogic.test.ts — TDD for pure client-side lossDate validation.
 *
 * Mirrors functional-spec §14.3 (client-side validation, mirrors server §7.2):
 *   - empty → valid (omit lossDate)
 *   - non-empty → must be a real YYYY-MM-DD date; lossDate <= today; lossDate >= edd - 301d
 *   - out-of-range → non-judgemental 'range' error (never blaming)
 *   - malformed → 'malformed' error
 */

import { validateLossDate, buildLossEventInput } from './lossEventLogic';

describe('validateLossDate', () => {
  it('empty string is valid (date omitted — LOSS-INV-11)', () => {
    expect(validateLossDate('', '2026-07-11', '2026-12-25')).toEqual({ valid: true });
  });

  it('valid date within range passes', () => {
    expect(validateLossDate('2026-06-30', '2026-07-11', '2026-12-25')).toEqual({ valid: true });
  });

  it('malformed date string → malformed error', () => {
    expect(validateLossDate('2026/06/30', '2026-07-11', '2026-12-25')).toEqual({
      valid: false,
      error: 'malformed',
    });
  });

  it('impossible calendar date → malformed error', () => {
    expect(validateLossDate('2026-13-40', '2026-07-11', '2026-12-25')).toEqual({
      valid: false,
      error: 'malformed',
    });
  });

  it('date with time component → malformed error (date-only, S6)', () => {
    expect(validateLossDate('2026-06-30T12:00:00', '2026-07-11', '2026-12-25')).toEqual({
      valid: false,
      error: 'malformed',
    });
  });

  it('future date (after today) → range error', () => {
    expect(validateLossDate('2026-07-12', '2026-07-11', '2026-12-25')).toEqual({
      valid: false,
      error: 'range',
    });
  });

  it('date today is allowed (upper bound is inclusive)', () => {
    expect(validateLossDate('2026-07-11', '2026-07-11', '2026-12-25')).toEqual({ valid: true });
  });

  it('date far before edd-301d → range error (same sub-code as upper bound)', () => {
    // edd 2026-12-25 - 301d ≈ 2026-02-28; go well before that
    expect(validateLossDate('2025-01-01', '2026-07-11', '2026-12-25')).toEqual({
      valid: false,
      error: 'range',
    });
  });

  it('date exactly at the lower floor (edd-301d) is allowed', () => {
    // edd - 301 days
    const edd = '2026-12-25';
    const eddDate = new Date(Date.UTC(2026, 11, 25));
    eddDate.setUTCDate(eddDate.getUTCDate() - 301);
    const floor = eddDate.toISOString().slice(0, 10);
    expect(validateLossDate(floor, '2026-07-11', edd)).toEqual({ valid: true });
  });
});

describe('buildLossEventInput', () => {
  it('empty date → body with no lossDate key (omitted, not null)', () => {
    expect(buildLossEventInput('')).toEqual({});
  });

  it('non-empty valid date → body carries lossDate', () => {
    expect(buildLossEventInput('2026-06-30')).toEqual({ lossDate: '2026-06-30' });
  });
});
