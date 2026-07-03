/**
 * doctorPdfLogic — pure state-machine transitions for the doctor PDF flow.
 *
 * States:
 *   idle            — default; user has not tapped "สร้าง PDF"
 *   generating      — printToFileAsync + shareAsync in flight
 *   shared          — share sheet was shown (success)
 *   error           — printToFileAsync or shareAsync failed
 *   consent_declined — user tapped "Not now" in the JIT sheet
 *
 * All transitions return a new state object (immutable).
 *
 * These functions are pure — no React, no hooks — so they are fast to test.
 */

// ─── State type ───────────────────────────────────────────────────────────────

export type DoctorPdfStatus =
  | 'idle'
  | 'generating'
  | 'shared'
  | 'error'
  | 'consent_declined';

export interface DoctorPdfState {
  status: DoctorPdfStatus;
  error: string | null;
  fileUri: string | null;
}

// ─── Initial state ────────────────────────────────────────────────────────────

export const initialDoctorPdfState: DoctorPdfState = {
  status: 'idle',
  error: null,
  fileUri: null,
};

// ─── Transitions ──────────────────────────────────────────────────────────────

/** User tapped the generate button → start async work. */
export function applyGenerateStart(prev: DoctorPdfState): DoctorPdfState {
  return { status: 'generating', error: null, fileUri: null };
}

/** printToFileAsync + shareAsync both succeeded. */
export function applyGenerateSuccess(
  prev: DoctorPdfState,
  fileUri: string,
): DoctorPdfState {
  return { status: 'shared', error: null, fileUri };
}

/** One of the async calls rejected. */
export function applyGenerateError(
  prev: DoctorPdfState,
  error: string,
): DoctorPdfState {
  return { status: 'error', error, fileUri: null };
}

/** User tapped "Not now" / "ไม่ใช่ตอนนี้" in the JIT consent sheet. */
export function applyConsentDeclined(prev: DoctorPdfState): DoctorPdfState {
  return { status: 'consent_declined', error: null, fileUri: null };
}

/** Reset back to idle (e.g. user taps "try again" or navigates away). */
export function applyReset(prev: DoctorPdfState): DoctorPdfState {
  return { ...initialDoctorPdfState };
}
