/**
 * consentGate.test.ts — BEHAVIORAL tests for the pdf_egress consent gate.
 *
 * Tests the pure gate-decision logic (decidePdfEgressAction) extracted so it
 * can be verified without React Native rendering. This is the critical PDPA
 * test: no health data must reach the assembler before pdf_egress is granted.
 *
 * States under test (spec §5 / pdf-doctor-ui.md):
 *   1. pdf_egress not granted → action='show_consent'; assembler NOT called
 *   2. pdf_egress declined → action='blocked'; re-arm available
 *   3. pdf_egress granted → action='generate'; assembler CAN be called
 *   4. error during generation → action='error'; retry available
 *   5. After decline, calling rearm resets to show_consent (not permanently blocked)
 *
 * Security invariant (PDPA / SD-9):
 *   No health data (kickSessions, appointments, profile) reaches buildDoctorReportHtml
 *   until pdf_egress has been actively granted.
 */

import {
  decidePdfEgressAction,
  type PdfEgressGateState,
  type PdfEgressAction,
} from './consentGate';

describe('decidePdfEgressAction — PDPA consent gate for pdf_egress', () => {

  // ── Gate: not yet decided ──────────────────────────────────────────────────

  it('returns show_consent when pdf_egress has not been granted', () => {
    const state: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: false,
      generationError: null,
    };
    const result = decidePdfEgressAction(state);
    expect(result).toBe<PdfEgressAction>('show_consent');
  });

  it('returns show_consent even when there is a prior error but consent is not yet granted', () => {
    const state: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: false,
      generationError: 'some_error',
    };
    const result = decidePdfEgressAction(state);
    // Consent gate takes precedence over error
    expect(result).toBe<PdfEgressAction>('show_consent');
  });

  // ── Gate: consent granted → allow generate ─────────────────────────────────

  it('returns generate when pdf_egress is granted and not declined', () => {
    const state: PdfEgressGateState = {
      pdfEgressGranted: true,
      declined: false,
      generationError: null,
    };
    const result = decidePdfEgressAction(state);
    expect(result).toBe<PdfEgressAction>('generate');
  });

  // ── Gate: declined → blocked (but re-armable) ──────────────────────────────

  it('returns blocked when the user has declined', () => {
    const state: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: true,
      generationError: null,
    };
    const result = decidePdfEgressAction(state);
    expect(result).toBe<PdfEgressAction>('blocked');
  });

  it('returns blocked even if granted=true but declined is set (decline takes precedence after JIT)', () => {
    // This can happen if consent was granted but user re-opened and declined again
    const state: PdfEgressGateState = {
      pdfEgressGranted: true,
      declined: true,
      generationError: null,
    };
    // declined=true means the user just tapped decline in this session — show blocked
    const result = decidePdfEgressAction(state);
    expect(result).toBe<PdfEgressAction>('blocked');
  });

  // ── Gate: error during generation ─────────────────────────────────────────

  it('returns error when pdf_egress is granted but generation failed', () => {
    const state: PdfEgressGateState = {
      pdfEgressGranted: true,
      declined: false,
      generationError: 'print_failed',
    };
    const result = decidePdfEgressAction(state);
    expect(result).toBe<PdfEgressAction>('error');
  });

  // ── Security invariant: assembler must NOT be called before consent ─────────

  it('does not reach generate when pdf_egress is false', () => {
    const assemblerCallCount = { n: 0 };

    const state: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: false,
      generationError: null,
    };
    const action = decidePdfEgressAction(state);

    if (action === 'generate') {
      assemblerCallCount.n += 1; // would call buildDoctorReportHtml in real code
    }

    // Critical: no health data should flow to the assembler without consent
    expect(assemblerCallCount.n).toBe(0);
  });

  it('allows generate only when pdf_egress is explicitly granted', () => {
    const grantedState: PdfEgressGateState = {
      pdfEgressGranted: true,
      declined: false,
      generationError: null,
    };
    const action = decidePdfEgressAction(grantedState);
    expect(action).toBe<PdfEgressAction>('generate');
  });
});

// ─── Re-arm tests (spec §4 — decline must be frictionless/re-armable) ─────────

describe('applyRearm — decline is not permanent', () => {
  it('is exported from consentGate', () => {
    const { applyRearm } = require('./consentGate');
    expect(typeof applyRearm).toBe('function');
  });

  it('resets declined=true to declined=false so the gate shows the consent sheet again', () => {
    const { applyRearm } = require('./consentGate');
    const declinedState: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: true,
      generationError: null,
    };
    const next = applyRearm(declinedState) as PdfEgressGateState;
    expect(next.declined).toBe(false);
    expect(next.pdfEgressGranted).toBe(false);
  });

  it('after rearm, decidePdfEgressAction returns show_consent (not blocked)', () => {
    const { applyRearm } = require('./consentGate');
    const declinedState: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: true,
      generationError: null,
    };
    const rearmed = applyRearm(declinedState) as PdfEgressGateState;
    const action = decidePdfEgressAction(rearmed);
    expect(action).toBe<PdfEgressAction>('show_consent');
  });

  it('rearm clears any generation error too', () => {
    const { applyRearm } = require('./consentGate');
    const state: PdfEgressGateState = {
      pdfEgressGranted: false,
      declined: true,
      generationError: 'some_error',
    };
    const next = applyRearm(state) as PdfEgressGateState;
    expect(next.generationError).toBeNull();
  });
});
