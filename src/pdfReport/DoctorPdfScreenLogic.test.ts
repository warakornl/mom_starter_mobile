/**
 * DoctorPdfScreenLogic.test.ts — TDD for the Builder screen's pure state logic.
 *
 * Tests the date-range preset calculation and builder state transitions
 * without any React Native or hook imports.
 *
 * Presets (spec §1):
 *   this_month   — from 1st of current month to today
 *   last_3_months — from (today - 3 months) to today
 *   all_time      — from '1900-01-01' to '9999-12-31'
 *
 * Phase machine:
 *   builder → generating → preview | error
 *   preview → share (OS sheet) | back (builder)
 */

import {
  computePresetRange,
  type DateRangePreset,
  type DateRange,
  builderPhaseInitial,
  applyPresetSelected,
  applyGeneratingStarted,
  applyPreviewReady,
  applyPreviewError,
  applyBackToBuilder,
  assembleReportIfGranted,
  type BuilderPhaseState,
} from './DoctorPdfScreenLogic';
import type { DoctorReportInput } from './doctorReportAssembler';

// ─── Preset range tests ────────────────────────────────────────────────────────

describe('computePresetRange', () => {
  const today = '2026-07-15';  // civil YYYY-MM-DD

  it('this_month: dateFrom = first of current month, dateTo = today', () => {
    const range = computePresetRange('this_month', today);
    expect(range.dateFrom).toBe('2026-07-01');
    expect(range.dateTo).toBe(today);
  });

  it('last_3_months: dateFrom = 3 months before today, dateTo = today', () => {
    const range = computePresetRange('last_3_months', today);
    // 3 months before 2026-07-15 → 2026-04-15
    expect(range.dateFrom).toBe('2026-04-15');
    expect(range.dateTo).toBe(today);
  });

  it('last_3_months: handles year boundary (e.g. Jan - 3 months = October previous year)', () => {
    const range = computePresetRange('last_3_months', '2026-01-15');
    expect(range.dateFrom).toBe('2025-10-15');
    expect(range.dateTo).toBe('2026-01-15');
  });

  it('all_time: dateFrom = 1900-01-01, dateTo = 9999-12-31', () => {
    const range = computePresetRange('all_time', today);
    expect(range.dateFrom).toBe('1900-01-01');
    expect(range.dateTo).toBe('9999-12-31');
  });

  it('returns a DateRange with both dateFrom and dateTo as strings', () => {
    const range = computePresetRange('this_month', today);
    expect(typeof range.dateFrom).toBe('string');
    expect(typeof range.dateTo).toBe('string');
  });

  it('dateFrom is always <= dateTo for this_month', () => {
    const range = computePresetRange('this_month', today);
    expect(range.dateFrom <= range.dateTo).toBe(true);
  });

  it('dateFrom is always <= dateTo for last_3_months', () => {
    const range = computePresetRange('last_3_months', today);
    expect(range.dateFrom <= range.dateTo).toBe(true);
  });

  // Date clamping: a 31-day month - 3 months can land on a short month
  it('last_3_months: clamps day to last day of target month (31st → Feb)', () => {
    // 2026-05-31 minus 3 months = 2026-02-?? → Feb has 28 days in 2026
    const range = computePresetRange('last_3_months', '2026-05-31');
    expect(range.dateFrom).toBe('2026-02-28');
    expect(range.dateTo).toBe('2026-05-31');
  });

  it('last_3_months: clamps 31st to 30 when target month has 30 days', () => {
    // 2026-08-31 minus 3 months = 2026-05-31 → May has 31 days, no clamp needed
    // 2026-07-31 minus 3 months = 2026-04-31 → April has 30 days, clamp to 30
    const range = computePresetRange('last_3_months', '2026-07-31');
    expect(range.dateFrom).toBe('2026-04-30');
    expect(range.dateTo).toBe('2026-07-31');
  });

  it('last_3_months: leap year Feb — clamps 31st to 29 in leap year', () => {
    // 2024-05-31 minus 3 months = 2024-02-?? → 2024 is a leap year → 29 days
    const range = computePresetRange('last_3_months', '2024-05-31');
    expect(range.dateFrom).toBe('2024-02-29');
    expect(range.dateTo).toBe('2024-05-31');
  });
});

// ─── Builder state machine tests ───────────────────────────────────────────────

describe('builderPhaseInitial', () => {
  it('starts in builder phase', () => {
    const state = builderPhaseInitial('2026-07-15');
    expect(state.phase).toBe('builder');
  });

  it('defaults to this_month preset', () => {
    const state = builderPhaseInitial('2026-07-15');
    expect(state.selectedPreset).toBe('this_month');
  });

  it('computes the correct initial range from this_month preset', () => {
    const state = builderPhaseInitial('2026-07-15');
    expect(state.dateFrom).toBe('2026-07-01');
    expect(state.dateTo).toBe('2026-07-15');
  });

  it('has no generation error initially', () => {
    const state = builderPhaseInitial('2026-07-15');
    expect(state.generationError).toBeNull();
  });

  it('has no generated HTML initially', () => {
    const state = builderPhaseInitial('2026-07-15');
    expect(state.generatedHtml).toBeNull();
  });
});

describe('applyPresetSelected', () => {
  const today = '2026-07-15';
  const initial = builderPhaseInitial(today);

  it('updates selectedPreset to last_3_months', () => {
    const next = applyPresetSelected(initial, 'last_3_months', today);
    expect(next.selectedPreset).toBe('last_3_months');
  });

  it('updates dateFrom when preset changes to last_3_months', () => {
    const next = applyPresetSelected(initial, 'last_3_months', today);
    expect(next.dateFrom).toBe('2026-04-15');
  });

  it('updates dateFrom when preset changes to all_time', () => {
    const next = applyPresetSelected(initial, 'all_time', today);
    expect(next.dateFrom).toBe('1900-01-01');
    expect(next.dateTo).toBe('9999-12-31');
  });

  it('stays in builder phase after preset change', () => {
    const next = applyPresetSelected(initial, 'last_3_months', today);
    expect(next.phase).toBe('builder');
  });

  it('returns a new state object (immutable)', () => {
    const next = applyPresetSelected(initial, 'all_time', today);
    expect(next).not.toBe(initial);
  });
});

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

// ─── assembleReportIfGranted tests ────────────────────────────────────────────

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
