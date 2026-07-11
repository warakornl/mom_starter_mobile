/**
 * lossEventLogic.test.ts — TDD for pure client-side lossDate validation.
 *
 * Mirrors functional-spec §14.3 (client-side validation, mirrors server §7.2):
 *   - empty → valid (omit lossDate)
 *   - non-empty → must be a real YYYY-MM-DD date; lossDate <= today; lossDate >= edd - 301d
 *   - out-of-range → non-judgemental 'range' error (never blaming)
 *   - malformed → 'malformed' error
 */

import { validateLossDate, buildLossEventInput, resolveReopenEntryGetOutcome } from './lossEventLogic';
import type { GetProfileResult } from './types';

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

// ─── resolveReopenEntryGetOutcome ─────────────────────────────────────────────
//
// mobile-reviewer BLOCKER-1 fix: ReopenConfirmScreen does its own GET-on-mount
// (mirrors ProfileInfoEditScreen's lifecycle-agnostic pattern) instead of
// requiring a route param profileVersion. This resolver is deliberately NOT
// gated to a single lifecycle — unlike resolveEditGetOutcome (pregnant-only,
// AC-2), a reopen entry is reachable ONLY when lifecycle === 'ended', so the
// resolver must accept an 'ended' profile as 'show-form' and treat any OTHER
// lifecycle as a benign guard (defense-in-depth if reached via a stale route).

function makeProfileResult(
  lifecycle: 'pregnant' | 'postpartum' | 'ended',
): Extract<GetProfileResult, { ok: true }> {
  return {
    ok: true,
    profile: {
      id: 'p1',
      version: 4,
      edd: '2026-12-25',
      eddBasis: 'due_date',
      lifecycle,
      gestationalWeek: 20,
      gestationalDay: 0,
      daysRemaining: 100,
      progress: 0.5,
      currentStage: 'T2',
      deliveryWindowActive: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    },
  };
}

describe('resolveReopenEntryGetOutcome', () => {
  it('null (in-flight) → loading', () => {
    expect(resolveReopenEntryGetOutcome(null)).toEqual({ type: 'loading' });
  });

  it('200 + ended → show-form (the ONLY state the reopen confirm is reachable in)', () => {
    const result = makeProfileResult('ended');
    expect(resolveReopenEntryGetOutcome(result)).toEqual({ type: 'show-form', profile: result.profile });
  });

  it('200 + pregnant → guard-not-editable (defense-in-depth; reopen only applies to ended)', () => {
    expect(resolveReopenEntryGetOutcome(makeProfileResult('pregnant'))).toEqual({ type: 'guard-not-editable' });
  });

  it('200 + postpartum → guard-not-editable', () => {
    expect(resolveReopenEntryGetOutcome(makeProfileResult('postpartum'))).toEqual({ type: 'guard-not-editable' });
  });

  it('404 → not-found', () => {
    expect(resolveReopenEntryGetOutcome({ ok: false, status: 404, code: 'not_found', message: 'x' })).toEqual({
      type: 'not-found',
    });
  });

  it('401 → session-expired (SD-5)', () => {
    expect(
      resolveReopenEntryGetOutcome({ ok: false, status: 401, code: 'unauthorized', message: 'x' }),
    ).toEqual({ type: 'session-expired' });
  });

  it('5xx/network → error (retryable)', () => {
    expect(
      resolveReopenEntryGetOutcome({ ok: false, status: 500, code: 'server_error', message: 'x' }),
    ).toEqual({ type: 'error', retryable: true });
  });
});
