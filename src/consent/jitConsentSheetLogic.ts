/**
 * jitConsentSheetLogic — pure helpers for JitConsentSheet component.
 *
 * Extracted here so they can be unit-tested without importing React Native.
 *
 * Design ref: first-run-consent.md §3.2, §5 (testID table)
 * 4 JIT types: pdf_egress, sensitive_lab_results, infant_feeding, child_health
 *
 * Note on short names:
 *   sensitive_lab_results → 'sensitive-lab' in all testIDs (§5 table)
 *   sensitive_lab_results decline uses 'hide-notes-btn' (§3.2b, not 'decline-btn')
 *
 * No React imports — fully testable in node environment.
 */

import type { ConsentType } from './types';

// ─── JIT type set ─────────────────────────────────────────────────────────────

/**
 * The 4 consent types that can be shown as JIT bottom sheets (§3.2).
 * general_health is first-run only (S3). cloud_storage is settings only (S8).
 */
export type JitConsentType =
  | 'pdf_egress'
  | 'sensitive_lab_results'
  | 'infant_feeding'
  | 'child_health';

export const JIT_TYPES: JitConsentType[] = [
  'pdf_egress',
  'sensitive_lab_results',
  'infant_feeding',
  'child_health',
];

// ─── testID maps — §5 first-run-consent.md ───────────────────────────────────

/** Sheet wrapper testIDs (§5) */
export const JIT_SHEET_TESTID: Record<JitConsentType, string> = {
  pdf_egress:            'consent-jit-sheet-pdf-egress',
  sensitive_lab_results: 'consent-jit-sheet-sensitive-lab',
  infant_feeding:        'consent-jit-sheet-infant-feeding',
  child_health:          'consent-jit-sheet-child-health',
};

/** Grant button testIDs (§5) */
export const JIT_GRANT_BTN_TESTID: Record<JitConsentType, string> = {
  pdf_egress:            'consent-jit-grant-btn-pdf-egress',
  sensitive_lab_results: 'consent-jit-grant-btn-sensitive-lab',
  infant_feeding:        'consent-jit-grant-btn-infant-feeding',
  child_health:          'consent-jit-grant-btn-child-health',
};

/**
 * Decline / hide-notes button testIDs (§5).
 * sensitive_lab_results uses 'hide-notes-btn' (§3.2b) — not 'decline-btn'.
 */
export const JIT_DECLINE_BTN_TESTID: Record<JitConsentType, string> = {
  pdf_egress:            'consent-jit-decline-btn-pdf-egress',
  sensitive_lab_results: 'consent-jit-hide-notes-btn-sensitive-lab',
  infant_feeding:        'consent-jit-decline-btn-infant-feeding',
  child_health:          'consent-jit-decline-btn-child-health',
};

/** Error panel testIDs (§5) */
export const JIT_ERROR_PANEL_TESTID: Record<JitConsentType, string> = {
  pdf_egress:            'consent-jit-error-panel-pdf-egress',
  sensitive_lab_results: 'consent-jit-error-panel-sensitive-lab',
  infant_feeding:        'consent-jit-error-panel-infant-feeding',
  child_health:          'consent-jit-error-panel-child-health',
};

/** Retry button testIDs (§5) */
export const JIT_RETRY_BTN_TESTID: Record<JitConsentType, string> = {
  pdf_egress:            'consent-jit-retry-btn-pdf-egress',
  sensitive_lab_results: 'consent-jit-retry-btn-sensitive-lab',
  infant_feeding:        'consent-jit-retry-btn-infant-feeding',
  child_health:          'consent-jit-retry-btn-child-health',
};

/**
 * Parental attestation checkbox testIDs (§5).
 * Only defined for infant_feeding and child_health (ม.20 parental consent).
 * Partial record — deliberately absent for pdf_egress and sensitive_lab_results.
 */
export const JIT_PARENTAL_ATTEST_TESTID: Partial<Record<ConsentType, string>> = {
  infant_feeding: 'consent-jit-parental-attest-checkbox-infant-feeding',
  child_health:   'consent-jit-parental-attest-checkbox-child-health',
};
