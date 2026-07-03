/**
 * DoctorPdfScreenLogic — pure state machine for the Doctor PDF Builder screen.
 *
 * Spec ref: pdf-doctor-ui.md §1–§5
 *
 * No React imports — testable in Node without React Native.
 *
 * Date-range presets (spec §1):
 *   this_month    — 1st of current month → today
 *   last_3_months — today minus 3 months → today
 *   all_time      — 1900-01-01 → 9999-12-31
 *
 * Phase machine:
 *   builder     — user picks range + manifest toggles; Preview button enabled
 *   generating  — PDF HTML being assembled (spinner; cancel not supported in v1)
 *   preview     — HTML ready; faithful render (same sections/disclaimer) before share
 *   error       — generation failed; "ลองอีกครั้ง / try again" affordance
 *
 * All transitions return new state objects (immutable / pure).
 * No side effects, no store access.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** The three date-range presets (spec §1). */
export type DateRangePreset = 'this_month' | 'last_3_months' | 'all_time';

/** A civil date range for the report. Both are "YYYY-MM-DD". */
export interface DateRange {
  dateFrom: string;
  dateTo: string;
}

/** The phase the Builder screen is currently in. */
export type BuilderPhase = 'builder' | 'generating' | 'preview' | 'error';

/** Full state for the DoctorPdfScreen. */
export interface BuilderPhaseState {
  phase: BuilderPhase;
  selectedPreset: DateRangePreset;
  dateFrom: string;
  dateTo: string;
  /**
   * Whether to include sensitive notes in the PDF (spec §2.2).
   * Default false — requires sensitive_lab_results consent to turn on.
   */
  includeSensitiveNotes: boolean;
  /** The assembled HTML (non-null in preview + post-generation phases). */
  generatedHtml: string | null;
  /** Non-null when phase === 'error'. */
  generationError: string | null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Zero-pad a number to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * computePresetRange — derive the [dateFrom, dateTo] range for a given preset.
 *
 * @param preset  The user-selected preset.
 * @param today   Civil "YYYY-MM-DD" date (injected for testability).
 */
export function computePresetRange(preset: DateRangePreset, today: string): DateRange {
  if (preset === 'all_time') {
    return { dateFrom: '1900-01-01', dateTo: '9999-12-31' };
  }

  const [y, m, d] = today.split('-').map(Number);

  if (preset === 'this_month') {
    const dateFrom = `${y}-${pad2(m)}-01`;
    return { dateFrom, dateTo: today };
  }

  // last_3_months: subtract 3 calendar months
  let fromYear = y;
  let fromMonth = m - 3;
  if (fromMonth <= 0) {
    fromMonth += 12;
    fromYear -= 1;
  }
  const dateFrom = `${fromYear}-${pad2(fromMonth)}-${pad2(d)}`;
  return { dateFrom, dateTo: today };
}

// ─── State factory ────────────────────────────────────────────────────────────

/**
 * builderPhaseInitial — create initial state for the Builder screen.
 *
 * Default preset: this_month (spec §1 default).
 * @param today  Civil "YYYY-MM-DD" date (from localCivilToday() at the call site).
 */
export function builderPhaseInitial(today: string): BuilderPhaseState {
  const { dateFrom, dateTo } = computePresetRange('this_month', today);
  return {
    phase: 'builder',
    selectedPreset: 'this_month',
    dateFrom,
    dateTo,
    includeSensitiveNotes: false,
    generatedHtml: null,
    generationError: null,
  };
}

// ─── State transitions ────────────────────────────────────────────────────────

/**
 * applyPresetSelected — user tapped a preset chip.
 * Updates selectedPreset and recomputes the date range.
 */
export function applyPresetSelected(
  prev: BuilderPhaseState,
  preset: DateRangePreset,
  today: string,
): BuilderPhaseState {
  const { dateFrom, dateTo } = computePresetRange(preset, today);
  return {
    ...prev,
    selectedPreset: preset,
    dateFrom,
    dateTo,
  };
}

/**
 * applyGeneratingStarted — user tapped Preview; HTML assembly begins.
 * Clears any prior HTML + error; moves to 'generating' phase.
 */
export function applyGeneratingStarted(prev: BuilderPhaseState): BuilderPhaseState {
  return {
    ...prev,
    phase: 'generating',
    generatedHtml: null,
    generationError: null,
  };
}

/**
 * applyPreviewReady — HTML assembly completed; move to preview.
 * The html is the output of buildDoctorReportHtml (pure assembler).
 */
export function applyPreviewReady(prev: BuilderPhaseState, html: string): BuilderPhaseState {
  return {
    ...prev,
    phase: 'preview',
    generatedHtml: html,
    generationError: null,
  };
}

/**
 * applyPreviewError — HTML assembly or PDF generation failed.
 * Shows the error panel with retry (spec §5 error state).
 */
export function applyPreviewError(prev: BuilderPhaseState, error: string): BuilderPhaseState {
  return {
    ...prev,
    phase: 'error',
    generationError: error,
    generatedHtml: null,
  };
}

/**
 * applyBackToBuilder — user tapped ‹ back from preview or error.
 * Returns to builder so the user can adjust the range or retrigger.
 */
export function applyBackToBuilder(prev: BuilderPhaseState): BuilderPhaseState {
  return {
    ...prev,
    phase: 'builder',
    generationError: null,
  };
}
