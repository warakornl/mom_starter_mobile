/**
 * doctorPdfLogic.test.ts — TDD for the PDF-report state machine.
 *
 * This is the pure orchestration logic, extracted from any React/hook:
 *   applyGenerateStart   — transitions idle → generating
 *   applyGenerateSuccess — transitions generating → shared
 *   applyGenerateError   — transitions generating → error
 *   applyConsentDeclined — transitions any → consent_declined
 *   applyReset           — transitions any → idle
 *   initialDoctorPdfState — correct initial state
 *
 * State machine states:
 *   idle → generating → shared | error | consent_declined
 *   idle (when consent gate shows JIT sheet — gated by gate === 'show_jit')
 *   consent_declined (after user taps "Not now")
 *
 * These are pure functions — no hooks, no React — so they are fast and
 * straightforward to test.
 */

import {
  initialDoctorPdfState,
  applyGenerateStart,
  applyGenerateSuccess,
  applyGenerateError,
  applyConsentDeclined,
  applyReset,
  type DoctorPdfState,
} from './doctorPdfLogic';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('initialDoctorPdfState', () => {
  it('starts in idle state', () => {
    expect(initialDoctorPdfState.status).toBe('idle');
  });

  it('has no error in initial state', () => {
    expect(initialDoctorPdfState.error).toBeNull();
  });

  it('has no fileUri in initial state', () => {
    expect(initialDoctorPdfState.fileUri).toBeNull();
  });
});

describe('applyGenerateStart', () => {
  it('transitions to generating from idle', () => {
    const next = applyGenerateStart(initialDoctorPdfState);
    expect(next.status).toBe('generating');
  });

  it('clears any previous error', () => {
    const errorState: DoctorPdfState = {
      status: 'error',
      error: 'previous_error',
      fileUri: null,
    };
    const next = applyGenerateStart(errorState);
    expect(next.error).toBeNull();
  });

  it('clears any previous fileUri', () => {
    const prevState: DoctorPdfState = {
      status: 'shared',
      error: null,
      fileUri: 'file:///tmp/prev.pdf',
    };
    const next = applyGenerateStart(prevState);
    expect(next.fileUri).toBeNull();
  });
});

describe('applyGenerateSuccess', () => {
  const generatingState: DoctorPdfState = {
    status: 'generating',
    error: null,
    fileUri: null,
  };

  it('transitions to shared', () => {
    const next = applyGenerateSuccess(generatingState, 'file:///tmp/report.pdf');
    expect(next.status).toBe('shared');
  });

  it('stores the file URI', () => {
    const uri = 'file:///tmp/report.pdf';
    const next = applyGenerateSuccess(generatingState, uri);
    expect(next.fileUri).toBe(uri);
  });

  it('clears any error', () => {
    const next = applyGenerateSuccess(generatingState, 'file:///tmp/report.pdf');
    expect(next.error).toBeNull();
  });
});

describe('applyGenerateError', () => {
  const generatingState: DoctorPdfState = {
    status: 'generating',
    error: null,
    fileUri: null,
  };

  it('transitions to error', () => {
    const next = applyGenerateError(generatingState, 'print_failed');
    expect(next.status).toBe('error');
  });

  it('stores the error message', () => {
    const next = applyGenerateError(generatingState, 'print_failed');
    expect(next.error).toBe('print_failed');
  });

  it('clears any fileUri', () => {
    const next = applyGenerateError(generatingState, 'print_failed');
    expect(next.fileUri).toBeNull();
  });
});

describe('applyConsentDeclined', () => {
  it('transitions from idle to consent_declined', () => {
    const next = applyConsentDeclined(initialDoctorPdfState);
    expect(next.status).toBe('consent_declined');
  });

  it('transitions from error to consent_declined', () => {
    const errorState: DoctorPdfState = { status: 'error', error: 'x', fileUri: null };
    const next = applyConsentDeclined(errorState);
    expect(next.status).toBe('consent_declined');
  });

  it('preserves null error and fileUri', () => {
    const next = applyConsentDeclined(initialDoctorPdfState);
    expect(next.error).toBeNull();
    expect(next.fileUri).toBeNull();
  });
});

describe('applyReset', () => {
  it('transitions from consent_declined to idle', () => {
    const declined: DoctorPdfState = { status: 'consent_declined', error: null, fileUri: null };
    const next = applyReset(declined);
    expect(next.status).toBe('idle');
  });

  it('transitions from error to idle', () => {
    const errorState: DoctorPdfState = { status: 'error', error: 'x', fileUri: null };
    const next = applyReset(errorState);
    expect(next.status).toBe('idle');
  });

  it('clears error and fileUri', () => {
    const errorState: DoctorPdfState = {
      status: 'error',
      error: 'some_error',
      fileUri: 'file:///tmp/x.pdf',
    };
    const next = applyReset(errorState);
    expect(next.error).toBeNull();
    expect(next.fileUri).toBeNull();
  });
});

// ─── Immutability ──────────────────────────────────────────────────────────────

describe('state transitions are immutable', () => {
  it('applyGenerateStart returns a new object', () => {
    const prev = initialDoctorPdfState;
    const next = applyGenerateStart(prev);
    expect(next).not.toBe(prev);
  });

  it('applyGenerateSuccess returns a new object', () => {
    const generating: DoctorPdfState = { status: 'generating', error: null, fileUri: null };
    const next = applyGenerateSuccess(generating, 'file:///x.pdf');
    expect(next).not.toBe(generating);
  });

  it('applyGenerateError returns a new object', () => {
    const generating: DoctorPdfState = { status: 'generating', error: null, fileUri: null };
    const next = applyGenerateError(generating, 'err');
    expect(next).not.toBe(generating);
  });
});
