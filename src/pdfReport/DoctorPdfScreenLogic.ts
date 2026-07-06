/**
 * DoctorPdfScreenLogic — pure state machine for the Doctor PDF Builder screen.
 *
 * Spec ref: pdf-doctor-ui.md §1–§5; bottom-tab-navigation-design.md v2.1 §8A.2
 *
 * No React imports — testable in Node without React Native.
 *
 * v2 date-range (spec §8A.2 OQ-NAV-4):
 *   Replace preset chips (this_month / last_3_months / all_time) with month pickers:
 *   monthFrom  — YYYY-MM, start month
 *   monthTo    — YYYY-MM, end month
 *   dateFrom   — YYYY-MM-01 (first calendar day of monthFrom)
 *   dateTo     — YYYY-MM-DD (last calendar day of monthTo)
 *   Default:   monthFrom = current month − 3, monthTo = current month
 *              → rolling 4-month window (e.g. Apr–Jul 2026 when today = 2026-07-xx)
 *
 * Validation: monthFrom ≤ monthTo (year first, then month number).
 * Invalid range → Preview button disabled; error shown below monthTo field.
 *
 * Phase machine (unchanged from v1):
 *   builder     — user picks range + manifest toggles; Preview button enabled when valid
 *   generating  — PDF HTML being assembled (spinner; cancel not supported in v1)
 *   preview     — HTML ready; faithful render (same sections/disclaimer) before share
 *   error       — generation failed; "ลองอีกครั้ง / try again" affordance
 *
 * All transitions return new state objects (immutable / pure).
 * No side effects, no store access.
 */

import type { PdfEgressAction } from './consentGate';
import type { DoctorReportInput } from './doctorReportAssembler';

// ─── Types ────────────────────────────────────────────────────────────────────

/** The phase the Builder screen is currently in. */
export type BuilderPhase = 'builder' | 'generating' | 'preview' | 'error';

/** Full state for the DoctorPdfScreen (v2: monthFrom/monthTo replace selectedPreset). */
export interface BuilderPhaseState {
  phase: BuilderPhase;
  /** Start month in YYYY-MM format (e.g. '2026-04'). */
  monthFrom: string;
  /** End month in YYYY-MM format (e.g. '2026-07'). */
  monthTo: string;
  /** Derived: YYYY-MM-01 (first calendar day of monthFrom). */
  dateFrom: string;
  /** Derived: last calendar day of monthTo (e.g. '2026-07-31'). */
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

// ─── Internal date helpers ────────────────────────────────────────────────────

/** Zero-pad a number to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * computeLastDayOfMonth — return last calendar day of a YYYY-MM month string.
 *
 * Uses `new Date(year, monthIndex, 0).getDate()` which returns the day
 * count of the month before monthIndex — equivalent to the last day of
 * the 1-indexed month. This correctly handles Feb in leap years.
 */
function computeLastDayOfMonth(yyyyMm: string): number {
  const [y, m] = yyyyMm.split('-').map(Number);
  // new Date(y, m, 0): monthIndex=m, day=0 → last day of month m (1-indexed)
  return new Date(y, m, 0).getDate();
}

/**
 * monthTodateRange — compute dateFrom/dateTo from YYYY-MM strings.
 *
 * dateFrom = YYYY-MM-01 (spec §8A.2)
 * dateTo   = YYYY-MM-DD where DD = last day of monthTo
 */
function monthToDateRange(monthFrom: string, monthTo: string): { dateFrom: string; dateTo: string } {
  const dateFrom = `${monthFrom}-01`;
  const lastDay = computeLastDayOfMonth(monthTo);
  const dateTo = `${monthTo}-${pad2(lastDay)}`;
  return { dateFrom, dateTo };
}

// ─── State factory ────────────────────────────────────────────────────────────

/**
 * builderPhaseInitial — create initial state for the Builder screen.
 *
 * Default range (spec §8A.2):
 *   monthFrom = current month − 3 calendar months
 *   monthTo   = current month
 *   → rolling 4-month window covering the typical ANC check-up report period
 *
 * @param today  Civil "YYYY-MM-DD" date (from localCivilToday() at the call site).
 */
export function builderPhaseInitial(today: string): BuilderPhaseState {
  const [y, m] = today.split('-').map(Number);

  // Compute monthTo = current month
  const monthTo = `${y}-${pad2(m)}`;

  // Compute monthFrom = current month − 3 (handle year boundary)
  let fromYear = y;
  let fromMonth = m - 3;
  if (fromMonth <= 0) {
    fromMonth += 12;
    fromYear -= 1;
  }
  const monthFrom = `${fromYear}-${pad2(fromMonth)}`;

  const { dateFrom, dateTo } = monthToDateRange(monthFrom, monthTo);

  return {
    phase: 'builder',
    monthFrom,
    monthTo,
    dateFrom,
    dateTo,
    includeSensitiveNotes: false,
    generatedHtml: null,
    generationError: null,
  };
}

// ─── State transitions ────────────────────────────────────────────────────────

/**
 * applyMonthFromChanged — user changed the "Month from" picker.
 * Updates monthFrom, recomputes dateFrom, clears any cached HTML.
 */
export function applyMonthFromChanged(
  prev: BuilderPhaseState,
  monthFrom: string,
): BuilderPhaseState {
  const dateFrom = `${monthFrom}-01`;
  return {
    ...prev,
    monthFrom,
    dateFrom,
    generatedHtml: null,
  };
}

/**
 * applyMonthToChanged — user changed the "Month to" picker.
 * Updates monthTo, recomputes dateTo (last day of the selected month), clears cached HTML.
 */
export function applyMonthToChanged(
  prev: BuilderPhaseState,
  monthTo: string,
): BuilderPhaseState {
  const lastDay = computeLastDayOfMonth(monthTo);
  const dateTo = `${monthTo}-${pad2(lastDay)}`;
  return {
    ...prev,
    monthTo,
    dateTo,
    generatedHtml: null,
  };
}

/**
 * isDateRangeValid — selector for whether the current month range is valid.
 *
 * Valid when monthFrom ≤ monthTo (string comparison: YYYY-MM lexicographic order
 * is equivalent to chronological order for ISO month strings).
 *
 * Used to disable the Preview button and show inline error when invalid (spec §8A.2).
 */
export function isDateRangeValid(state: BuilderPhaseState): boolean {
  return state.monthFrom <= state.monthTo;
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

// ─── PDPA-safe assembler gateway ─────────────────────────────────────────────

/**
 * assembleReportIfGranted — call the report assembler ONLY when the gate allows.
 *
 * This function is the testable extraction of the "on Preview/Generate tap"
 * handler used by DoctorPdfScreen. Keeping it here (outside the component)
 * allows unit tests to spy on the real buildDoctorReportHtml via jest.spyOn
 * without rendering any React Native component.
 *
 * PDPA invariant (spec §5, SD-9):
 *   Health data (kick sessions, appointments, profile) must NOT reach the
 *   assembler unless decidePdfEgressAction returns 'generate'. This function
 *   enforces that contract as a single, observable choke-point.
 *
 * @param gateAction   Result of decidePdfEgressAction — controls whether we proceed.
 * @param assembler    Injectable assembler function (real or spy in tests).
 * @param input        Full DoctorReportInput to pass to the assembler.
 * @returns            The assembled HTML string, or null if blocked.
 */
export function assembleReportIfGranted(
  gateAction: PdfEgressAction,
  assembler: (input: DoctorReportInput) => string,
  input: DoctorReportInput,
): string | null {
  if (gateAction !== 'generate') return null;
  return assembler(input);
}
