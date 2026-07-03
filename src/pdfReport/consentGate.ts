/**
 * consentGate — pure gate-decision logic for the pdf_egress consent gate.
 *
 * This module is extracted from the DoctorPdfScreen component so the consent
 * gating logic can be unit-tested without React Native or hook imports.
 *
 * PDPA / Security contract (spec §5, SD-9):
 *   - No health data (kick sessions, appointments, profile) must flow to
 *     buildDoctorReportHtml UNLESS decidePdfEgressAction returns 'generate'.
 *   - The gate is fail-closed: any unknown/falsy pdfEgressGranted → 'show_consent'.
 *   - decline is NOT permanent (spec §4): applyRearm() resets the declined flag
 *     so the user can try again without remounting the screen.
 *
 * State machine:
 *   pdfEgressGranted=false, declined=false → show_consent (default)
 *   pdfEgressGranted=false, declined=true  → blocked (re-armable via applyRearm)
 *   pdfEgressGranted=true,  declined=false, error=null → generate
 *   pdfEgressGranted=true,  declined=false, error!=null → error (retry)
 *   declined=true (any granted value)      → blocked (session-level decline wins)
 *
 * Never logs health data; operates on consent booleans only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Current gate state — tracks consent + session-level decline + generation error. */
export interface PdfEgressGateState {
  /** True if pdf_egress consent is granted in the consent store. */
  pdfEgressGranted: boolean;
  /** True if the user tapped Decline in this session (not permanent). */
  declined: boolean;
  /** Non-null if the last PDF generation attempt threw an error. */
  generationError: string | null;
}

/**
 * The action the caller should take given the current gate state.
 *
 *   show_consent — show the pdf_egress JIT consent sheet
 *   generate     — consent granted; call buildDoctorReportHtml + pdfService
 *   blocked      — user declined; show blocked message + rearm affordance
 *   error        — generation failed; show error panel + retry
 */
export type PdfEgressAction = 'show_consent' | 'generate' | 'blocked' | 'error';

// ─── Pure decision function ────────────────────────────────────────────────────

/**
 * decidePdfEgressAction — pure gate evaluation.
 *
 * Priority order (highest first):
 *   1. declined → blocked (session choice must be respected)
 *   2. not granted → show_consent (fail-closed)
 *   3. error → error (generation failed)
 *   4. granted, no error → generate
 *
 * PDPA: callers must check the return value BEFORE calling buildDoctorReportHtml.
 * Only 'generate' permits sending data to the assembler.
 */
export function decidePdfEgressAction(state: PdfEgressGateState): PdfEgressAction {
  if (state.declined) return 'blocked';
  if (!state.pdfEgressGranted) return 'show_consent';
  if (state.generationError !== null) return 'error';
  return 'generate';
}

// ─── State transitions ────────────────────────────────────────────────────────

/**
 * applyRearm — reset the declined flag so the consent sheet can be shown again.
 *
 * Spec §4: "After decline, [...] retry re-arms the consent hook so the user can
 * try again without remounting."
 *
 * Does NOT change pdfEgressGranted (that requires the actual consent POST).
 * Also clears any prior generation error so the screen is in a clean state.
 *
 * This is a pure immutable transition — returns a new state object.
 */
export function applyRearm(prev: PdfEgressGateState): PdfEgressGateState {
  return {
    ...prev,
    declined: false,
    generationError: null,
  };
}

/** Initial gate state — fail-closed, not declined, no error. */
export const initialPdfEgressGateState: PdfEgressGateState = {
  pdfEgressGranted: false,
  declined: false,
  generationError: null,
};
