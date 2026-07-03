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
import * as assemblerModule from './doctorReportAssembler';
import type { DoctorReportInput } from './doctorReportAssembler';
import { assembleReportIfGranted } from './DoctorPdfScreenLogic';

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

// ─── PDPA invariant: real assembler spy (SD-9) ────────────────────────────────
//
// These tests prove the end-to-end PDPA invariant using jest.spyOn on the REAL
// buildDoctorReportHtml from doctorReportAssembler (not a local counter).
// The assembleReportIfGranted function mirrors the "on Preview tap" handler
// logic in DoctorPdfScreen: it checks decidePdfEgressAction and only forwards
// health data to the assembler when the gate returns 'generate'.

/** Minimal valid input — empty arrays; assembler is spied/mocked so data doesn't matter. */
const MINIMAL_INPUT: DoctorReportInput = {
  profile: { edd: '2026-12-01', gestationalWeek: 20, lifecycle: 'pregnant' },
  kickSessions: [],
  appointments: [],
  dateFrom: '2026-01-01',
  dateTo: '2026-12-31',
  reportDate: '2026-07-01',
  locale: 'th',
};

describe('PDPA invariant: buildDoctorReportHtml NOT called before consent (real spy)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('UNGRANTED (show_consent) → assembler called 0 times — no health data assembled', () => {
    const spy = jest.spyOn(assemblerModule, 'buildDoctorReportHtml');
    const gateAction = decidePdfEgressAction({
      pdfEgressGranted: false,
      declined: false,
      generationError: null,
    });
    // gateAction is 'show_consent'; assembleReportIfGranted must not call the assembler
    assembleReportIfGranted(gateAction, assemblerModule.buildDoctorReportHtml, MINIMAL_INPUT);
    expect(spy).not.toHaveBeenCalled();
  });

  it('GRANTED → assembler called exactly once — health data flows after consent', () => {
    // Mock the return so the HTML builder doesn't run in the test process
    const spy = jest.spyOn(assemblerModule, 'buildDoctorReportHtml').mockReturnValue('<html/>');
    const gateAction = decidePdfEgressAction({
      pdfEgressGranted: true,
      declined: false,
      generationError: null,
    });
    // gateAction is 'generate'; assembleReportIfGranted must call the assembler once
    const result = assembleReportIfGranted(gateAction, assemblerModule.buildDoctorReportHtml, MINIMAL_INPUT);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe('<html/>');
  });

  it('DECLINED (blocked) → assembler called 0 times — declined must be respected', () => {
    const spy = jest.spyOn(assemblerModule, 'buildDoctorReportHtml');
    const gateAction = decidePdfEgressAction({
      pdfEgressGranted: false,
      declined: true,
      generationError: null,
    });
    // gateAction is 'blocked'; assembler must not be called
    assembleReportIfGranted(gateAction, assemblerModule.buildDoctorReportHtml, MINIMAL_INPUT);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ERROR state → assembler called 0 times — retry must re-enter consent flow', () => {
    const spy = jest.spyOn(assemblerModule, 'buildDoctorReportHtml');
    const gateAction = decidePdfEgressAction({
      pdfEgressGranted: true,
      declined: false,
      generationError: 'print_failed',
    });
    // gateAction is 'error'; assembler must not be called on retry path
    assembleReportIfGranted(gateAction, assemblerModule.buildDoctorReportHtml, MINIMAL_INPUT);
    expect(spy).not.toHaveBeenCalled();
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
