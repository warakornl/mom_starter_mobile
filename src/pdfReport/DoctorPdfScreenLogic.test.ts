/**
 * DoctorPdfScreenLogic.test.ts — TDD for the Builder screen's pure state logic.
 *
 * v2 update (bottom-tab-navigation-design.md §8A.2 OQ-NAV-4):
 *   - Replaced preset chips (this_month / last_3_months / all_time) with
 *     monthFrom + monthTo YYYY-MM pickers.
 *   - Default range: monthFrom = current month − 3, monthTo = current month.
 *   - dateFrom = monthFrom-01, dateTo = last day of monthTo.
 *   - New selector: isDateRangeValid(state) = monthFrom ≤ monthTo.
 *   - Preview button disabled when validation error active.
 *   - computePresetRange / DateRangePreset / applyPresetSelected are retired
 *     (removed from public API; internal use only in legacy code).
 *
 * Phase machine (unchanged):
 *   builder → generating → preview | error
 *   preview → share (OS sheet) | back (builder)
 */

import {
  builderPhaseInitial,
  applyMonthFromChanged,
  applyMonthToChanged,
  isDateRangeValid,
  applyGeneratingStarted,
  applyPreviewReady,
  applyPreviewError,
  applyBackToBuilder,
  assembleReportIfGranted,
  type BuilderPhaseState,
} from './DoctorPdfScreenLogic';
import type { DoctorReportInput } from './doctorReportAssembler';

// ─── builderPhaseInitial — v2 month defaults ──────────────────────────────────

describe('builderPhaseInitial — v2 month-from/to defaults', () => {
  it('starts in builder phase', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(state.phase).toBe('builder');
  });

  it('monthTo defaults to current month (YYYY-MM)', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(state.monthTo).toBe('2026-07');
  });

  it('monthFrom defaults to 3 calendar months before current month', () => {
    // July 2026 − 3 months = April 2026
    const state = builderPhaseInitial('2026-07-06');
    expect(state.monthFrom).toBe('2026-04');
  });

  it('monthFrom handles year boundary (January − 3 = October previous year)', () => {
    const state = builderPhaseInitial('2026-01-15');
    expect(state.monthFrom).toBe('2025-10');
  });

  it('dateFrom is first day of monthFrom', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(state.dateFrom).toBe('2026-04-01');
  });

  it('dateTo is last day of monthTo (July has 31 days)', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(state.dateTo).toBe('2026-07-31');
  });

  it('dateTo last day handles February non-leap (28 days)', () => {
    // monthTo = 2026-02 (not leap) → dateTo = 2026-02-28
    const state = builderPhaseInitial('2026-02-10');
    expect(state.dateTo).toBe('2026-02-28');
  });

  it('dateTo last day handles February leap year (29 days)', () => {
    // monthTo = 2024-02 (leap) → dateTo = 2024-02-29
    const state = builderPhaseInitial('2024-02-15');
    expect(state.dateTo).toBe('2024-02-29');
  });

  it('has no generation error initially', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(state.generationError).toBeNull();
  });

  it('has no generated HTML initially', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(state.generatedHtml).toBeNull();
  });

  it('default range is valid (monthFrom ≤ monthTo)', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect(isDateRangeValid(state)).toBe(true);
  });

  it('does NOT have selectedPreset field (removed in v2)', () => {
    const state = builderPhaseInitial('2026-07-06');
    expect('selectedPreset' in state).toBe(false);
  });
});

// ─── applyMonthFromChanged ────────────────────────────────────────────────────

describe('applyMonthFromChanged', () => {
  const today = '2026-07-06';
  const initial = builderPhaseInitial(today);

  it('updates monthFrom to the given YYYY-MM', () => {
    const next = applyMonthFromChanged(initial, '2026-05');
    expect(next.monthFrom).toBe('2026-05');
  });

  it('sets dateFrom to first day of new monthFrom', () => {
    const next = applyMonthFromChanged(initial, '2026-05');
    expect(next.dateFrom).toBe('2026-05-01');
  });

  it('stays in builder phase', () => {
    const next = applyMonthFromChanged(initial, '2026-05');
    expect(next.phase).toBe('builder');
  });

  it('clears generatedHtml (range changed — any cached preview is stale)', () => {
    const withHtml: BuilderPhaseState = { ...initial, generatedHtml: '<html/>' };
    const next = applyMonthFromChanged(withHtml, '2026-05');
    expect(next.generatedHtml).toBeNull();
  });

  it('returns a new state object (immutable)', () => {
    const next = applyMonthFromChanged(initial, '2026-06');
    expect(next).not.toBe(initial);
  });

  it('does not change monthTo or dateTo', () => {
    const next = applyMonthFromChanged(initial, '2026-06');
    expect(next.monthTo).toBe(initial.monthTo);
    expect(next.dateTo).toBe(initial.dateTo);
  });
});

// ─── applyMonthToChanged ──────────────────────────────────────────────────────

describe('applyMonthToChanged', () => {
  const today = '2026-07-06';
  const initial = builderPhaseInitial(today);

  it('updates monthTo to the given YYYY-MM', () => {
    const next = applyMonthToChanged(initial, '2026-08');
    expect(next.monthTo).toBe('2026-08');
  });

  it('sets dateTo to last day of new monthTo (August = 31 days)', () => {
    const next = applyMonthToChanged(initial, '2026-08');
    expect(next.dateTo).toBe('2026-08-31');
  });

  it('sets dateTo to last day of April (30 days)', () => {
    const next = applyMonthToChanged(initial, '2026-04');
    expect(next.dateTo).toBe('2026-04-30');
  });

  it('sets dateTo to last day of Feb 2026 (non-leap = 28)', () => {
    const next = applyMonthToChanged(initial, '2026-02');
    expect(next.dateTo).toBe('2026-02-28');
  });

  it('sets dateTo to last day of Feb 2024 (leap = 29)', () => {
    const next = applyMonthToChanged(initial, '2024-02');
    expect(next.dateTo).toBe('2024-02-29');
  });

  it('stays in builder phase', () => {
    const next = applyMonthToChanged(initial, '2026-08');
    expect(next.phase).toBe('builder');
  });

  it('clears generatedHtml (range changed — cached preview is stale)', () => {
    const withHtml: BuilderPhaseState = { ...initial, generatedHtml: '<html/>' };
    const next = applyMonthToChanged(withHtml, '2026-08');
    expect(next.generatedHtml).toBeNull();
  });

  it('returns a new state object (immutable)', () => {
    const next = applyMonthToChanged(initial, '2026-09');
    expect(next).not.toBe(initial);
  });

  it('does not change monthFrom or dateFrom', () => {
    const next = applyMonthToChanged(initial, '2026-09');
    expect(next.monthFrom).toBe(initial.monthFrom);
    expect(next.dateFrom).toBe(initial.dateFrom);
  });
});

// ─── isDateRangeValid ─────────────────────────────────────────────────────────

describe('isDateRangeValid', () => {
  const today = '2026-07-06';

  it('returns true when monthFrom < monthTo (normal range)', () => {
    const state: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      monthFrom: '2026-04',
      monthTo: '2026-07',
      dateFrom: '2026-04-01',
      dateTo: '2026-07-31',
    };
    expect(isDateRangeValid(state)).toBe(true);
  });

  it('returns true when monthFrom === monthTo (single month — valid)', () => {
    const state: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      monthFrom: '2026-07',
      monthTo: '2026-07',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    };
    expect(isDateRangeValid(state)).toBe(true);
  });

  it('returns false when monthFrom > monthTo (invalid: from is after to)', () => {
    const state: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      monthFrom: '2026-08',
      monthTo: '2026-07',
      dateFrom: '2026-08-01',
      dateTo: '2026-07-31',
    };
    expect(isDateRangeValid(state)).toBe(false);
  });

  it('returns false when monthFrom is in a later year than monthTo', () => {
    const state: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      monthFrom: '2027-01',
      monthTo: '2026-12',
      dateFrom: '2027-01-01',
      dateTo: '2026-12-31',
    };
    expect(isDateRangeValid(state)).toBe(false);
  });

  it('returns true when monthFrom is in an earlier year than monthTo', () => {
    const state: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      monthFrom: '2025-11',
      monthTo: '2026-02',
      dateFrom: '2025-11-01',
      dateTo: '2026-02-28',
    };
    expect(isDateRangeValid(state)).toBe(true);
  });

  it('default initial state is always valid', () => {
    expect(isDateRangeValid(builderPhaseInitial('2026-07-06'))).toBe(true);
    expect(isDateRangeValid(builderPhaseInitial('2026-01-01'))).toBe(true);
    expect(isDateRangeValid(builderPhaseInitial('2025-12-31'))).toBe(true);
  });
});

// ─── Remaining phase machine tests (unchanged behavior) ───────────────────────

describe('applyGeneratingStarted', () => {
  const today = '2026-07-15';
  const initial = builderPhaseInitial(today);

  it('transitions from builder to generating phase', () => {
    const next = applyGeneratingStarted(initial);
    expect(next.phase).toBe('generating');
  });

  it('clears any prior error', () => {
    const withError: BuilderPhaseState = { ...initial, generationError: 'prev_err' };
    const next = applyGeneratingStarted(withError);
    expect(next.generationError).toBeNull();
  });

  it('clears any prior generated HTML', () => {
    const withHtml: BuilderPhaseState = { ...initial, generatedHtml: '<html/>' };
    const next = applyGeneratingStarted(withHtml);
    expect(next.generatedHtml).toBeNull();
  });
});

describe('applyPreviewReady', () => {
  const today = '2026-07-15';
  const generating: BuilderPhaseState = { ...builderPhaseInitial(today), phase: 'generating' };

  it('transitions from generating to preview phase', () => {
    const next = applyPreviewReady(generating, '<html>report</html>');
    expect(next.phase).toBe('preview');
  });

  it('stores the generated HTML', () => {
    const html = '<html>report</html>';
    const next = applyPreviewReady(generating, html);
    expect(next.generatedHtml).toBe(html);
  });

  it('clears any error', () => {
    const next = applyPreviewReady(generating, '<html/>');
    expect(next.generationError).toBeNull();
  });
});

describe('applyPreviewError', () => {
  const today = '2026-07-15';
  const generating: BuilderPhaseState = { ...builderPhaseInitial(today), phase: 'generating' };

  it('transitions from generating to error phase', () => {
    const next = applyPreviewError(generating, 'print_failed');
    expect(next.phase).toBe('error');
  });

  it('stores the error message', () => {
    const next = applyPreviewError(generating, 'print_failed');
    expect(next.generationError).toBe('print_failed');
  });
});

describe('applyBackToBuilder', () => {
  const today = '2026-07-15';

  it('transitions from preview back to builder', () => {
    const preview: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      phase: 'preview',
      generatedHtml: '<html/>',
    };
    const next = applyBackToBuilder(preview);
    expect(next.phase).toBe('builder');
  });

  it('transitions from error back to builder', () => {
    const error: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      phase: 'error',
      generationError: 'some_error',
    };
    const next = applyBackToBuilder(error);
    expect(next.phase).toBe('builder');
  });

  it('clears error on back', () => {
    const error: BuilderPhaseState = {
      ...builderPhaseInitial(today),
      phase: 'error',
      generationError: 'some_error',
    };
    const next = applyBackToBuilder(error);
    expect(next.generationError).toBeNull();
  });
});

// ─── assembleReportIfGranted tests (unchanged) ────────────────────────────────

describe('assembleReportIfGranted', () => {
  const minimalInput: DoctorReportInput = {
    profile: { edd: '2026-12-01', gestationalWeek: 20, lifecycle: 'pregnant' },
    kickSessions: [],
    appointments: [],
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
    reportDate: '2026-07-01',
    locale: 'th',
  };

  it('returns null when gateAction is show_consent (no health data forwarded)', () => {
    const mockAssembler = jest.fn().mockReturnValue('<html/>');
    const result = assembleReportIfGranted('show_consent', mockAssembler, minimalInput);
    expect(result).toBeNull();
    expect(mockAssembler).not.toHaveBeenCalled();
  });

  it('returns null when gateAction is blocked (declined)', () => {
    const mockAssembler = jest.fn().mockReturnValue('<html/>');
    const result = assembleReportIfGranted('blocked', mockAssembler, minimalInput);
    expect(result).toBeNull();
    expect(mockAssembler).not.toHaveBeenCalled();
  });

  it('returns null when gateAction is error (retry path — assembler not called)', () => {
    const mockAssembler = jest.fn().mockReturnValue('<html/>');
    const result = assembleReportIfGranted('error', mockAssembler, minimalInput);
    expect(result).toBeNull();
    expect(mockAssembler).not.toHaveBeenCalled();
  });

  it('calls assembler exactly once and returns HTML when gateAction is generate', () => {
    const mockAssembler = jest.fn().mockReturnValue('<html>report</html>');
    const result = assembleReportIfGranted('generate', mockAssembler, minimalInput);
    expect(mockAssembler).toHaveBeenCalledTimes(1);
    expect(mockAssembler).toHaveBeenCalledWith(minimalInput);
    expect(result).toBe('<html>report</html>');
  });
});
