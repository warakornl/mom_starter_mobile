/**
 * jitConsentSheet — unit tests (TDD, written BEFORE implementation).
 *
 * Tests pure logic helpers for the JitConsentSheet component:
 *   - JIT_TYPES: the 4 types that can have a JIT sheet
 *   - JIT_SHEET_TESTID: §5 sheet wrapper testIDs
 *   - JIT_GRANT_BTN_TESTID: §5 grant button testIDs
 *   - JIT_DECLINE_BTN_TESTID: §5 decline / hide-notes button testIDs
 *   - JIT_ERROR_PANEL_TESTID: §5 error panel testIDs
 *   - JIT_RETRY_BTN_TESTID: §5 retry button testIDs
 *   - JIT_PARENTAL_ATTEST_TESTID: §5 parental attestation checkbox testIDs
 *                                  (only infant_feeding + child_health, ม.20)
 *
 * Design ref: first-run-consent.md §3.2, §5 (testID table)
 */

import {
  JIT_TYPES,
  JIT_SHEET_TESTID,
  JIT_GRANT_BTN_TESTID,
  JIT_DECLINE_BTN_TESTID,
  JIT_ERROR_PANEL_TESTID,
  JIT_RETRY_BTN_TESTID,
  JIT_PARENTAL_ATTEST_TESTID,
} from './jitConsentSheetLogic';

// ─── JIT_TYPES ────────────────────────────────────────────────────────────────

describe('JIT_TYPES', () => {
  it('contains exactly 4 JIT consent types', () => {
    expect(JIT_TYPES).toHaveLength(4);
  });

  it('includes pdf_egress', () => {
    expect(JIT_TYPES).toContain('pdf_egress');
  });

  it('includes sensitive_lab_results', () => {
    expect(JIT_TYPES).toContain('sensitive_lab_results');
  });

  it('includes infant_feeding', () => {
    expect(JIT_TYPES).toContain('infant_feeding');
  });

  it('includes child_health', () => {
    expect(JIT_TYPES).toContain('child_health');
  });

  it('does NOT include general_health (first-run only, not JIT)', () => {
    expect(JIT_TYPES).not.toContain('general_health');
  });

  it('does NOT include cloud_storage (settings only, not JIT)', () => {
    expect(JIT_TYPES).not.toContain('cloud_storage');
  });
});

// ─── JIT_SHEET_TESTID ─────────────────────────────────────────────────────────

describe('JIT_SHEET_TESTID', () => {
  it('pdf_egress testID matches §5', () => {
    expect(JIT_SHEET_TESTID['pdf_egress']).toBe('consent-jit-sheet-pdf-egress');
  });

  it('sensitive_lab_results testID uses short form per §5', () => {
    expect(JIT_SHEET_TESTID['sensitive_lab_results']).toBe('consent-jit-sheet-sensitive-lab');
  });

  it('infant_feeding testID matches §5', () => {
    expect(JIT_SHEET_TESTID['infant_feeding']).toBe('consent-jit-sheet-infant-feeding');
  });

  it('child_health testID matches §5', () => {
    expect(JIT_SHEET_TESTID['child_health']).toBe('consent-jit-sheet-child-health');
  });
});

// ─── JIT_GRANT_BTN_TESTID ─────────────────────────────────────────────────────

describe('JIT_GRANT_BTN_TESTID', () => {
  it('pdf_egress grant testID matches §5', () => {
    expect(JIT_GRANT_BTN_TESTID['pdf_egress']).toBe('consent-jit-grant-btn-pdf-egress');
  });

  it('sensitive_lab_results grant testID uses short form', () => {
    expect(JIT_GRANT_BTN_TESTID['sensitive_lab_results']).toBe('consent-jit-grant-btn-sensitive-lab');
  });

  it('infant_feeding grant testID matches §5', () => {
    expect(JIT_GRANT_BTN_TESTID['infant_feeding']).toBe('consent-jit-grant-btn-infant-feeding');
  });

  it('child_health grant testID matches §5', () => {
    expect(JIT_GRANT_BTN_TESTID['child_health']).toBe('consent-jit-grant-btn-child-health');
  });
});

// ─── JIT_DECLINE_BTN_TESTID ───────────────────────────────────────────────────
// Note: sensitive_lab_results uses 'hide-notes-btn' (not 'decline-btn') per §3.2b

describe('JIT_DECLINE_BTN_TESTID', () => {
  it('pdf_egress decline testID matches §5', () => {
    expect(JIT_DECLINE_BTN_TESTID['pdf_egress']).toBe('consent-jit-decline-btn-pdf-egress');
  });

  it('sensitive_lab_results uses hide-notes-btn (not decline-btn per §3.2b)', () => {
    expect(JIT_DECLINE_BTN_TESTID['sensitive_lab_results']).toBe('consent-jit-hide-notes-btn-sensitive-lab');
  });

  it('infant_feeding decline testID matches §5', () => {
    expect(JIT_DECLINE_BTN_TESTID['infant_feeding']).toBe('consent-jit-decline-btn-infant-feeding');
  });

  it('child_health decline testID matches §5', () => {
    expect(JIT_DECLINE_BTN_TESTID['child_health']).toBe('consent-jit-decline-btn-child-health');
  });
});

// ─── JIT_ERROR_PANEL_TESTID ───────────────────────────────────────────────────

describe('JIT_ERROR_PANEL_TESTID', () => {
  it('pdf_egress error panel testID matches §5', () => {
    expect(JIT_ERROR_PANEL_TESTID['pdf_egress']).toBe('consent-jit-error-panel-pdf-egress');
  });

  it('sensitive_lab_results error panel uses short form', () => {
    expect(JIT_ERROR_PANEL_TESTID['sensitive_lab_results']).toBe('consent-jit-error-panel-sensitive-lab');
  });

  it('infant_feeding error panel testID matches §5', () => {
    expect(JIT_ERROR_PANEL_TESTID['infant_feeding']).toBe('consent-jit-error-panel-infant-feeding');
  });

  it('child_health error panel testID matches §5', () => {
    expect(JIT_ERROR_PANEL_TESTID['child_health']).toBe('consent-jit-error-panel-child-health');
  });
});

// ─── JIT_RETRY_BTN_TESTID ─────────────────────────────────────────────────────

describe('JIT_RETRY_BTN_TESTID', () => {
  it('pdf_egress retry testID matches §5', () => {
    expect(JIT_RETRY_BTN_TESTID['pdf_egress']).toBe('consent-jit-retry-btn-pdf-egress');
  });

  it('sensitive_lab_results retry testID uses short form', () => {
    expect(JIT_RETRY_BTN_TESTID['sensitive_lab_results']).toBe('consent-jit-retry-btn-sensitive-lab');
  });

  it('infant_feeding retry testID matches §5', () => {
    expect(JIT_RETRY_BTN_TESTID['infant_feeding']).toBe('consent-jit-retry-btn-infant-feeding');
  });

  it('child_health retry testID matches §5', () => {
    expect(JIT_RETRY_BTN_TESTID['child_health']).toBe('consent-jit-retry-btn-child-health');
  });
});

// ─── JIT_PARENTAL_ATTEST_TESTID ───────────────────────────────────────────────
// Only infant_feeding + child_health require parental attestation (ม.20)

describe('JIT_PARENTAL_ATTEST_TESTID', () => {
  it('infant_feeding parental attest checkbox testID matches §5', () => {
    expect(JIT_PARENTAL_ATTEST_TESTID['infant_feeding']).toBe(
      'consent-jit-parental-attest-checkbox-infant-feeding',
    );
  });

  it('child_health parental attest checkbox testID matches §5', () => {
    expect(JIT_PARENTAL_ATTEST_TESTID['child_health']).toBe(
      'consent-jit-parental-attest-checkbox-child-health',
    );
  });

  it('does NOT have a parental attest testID for pdf_egress (no attestation needed)', () => {
    expect(JIT_PARENTAL_ATTEST_TESTID['pdf_egress']).toBeUndefined();
  });

  it('does NOT have a parental attest testID for sensitive_lab_results', () => {
    expect(JIT_PARENTAL_ATTEST_TESTID['sensitive_lab_results']).toBeUndefined();
  });
});
