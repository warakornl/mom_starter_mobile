/**
 * consentManageLogic — unit tests (TDD, written BEFORE the implementation).
 *
 * Tests the pure logic for the S8 Manage-Consents screen:
 *   - Section grouping (core / sync & reports / baby data)
 *   - Which types require a withdrawal confirmation sheet (§3.3.2)
 *   - Utility helpers (sectionForType, withdrawalConfirmTestId)
 *
 * Design ref: first-run-consent.md §3.3 + §3.3.2
 */

import {
  needsWithdrawalConfirmation,
  SECTION_CONSENT_TYPES,
  CONSENT_SECTION_ORDER,
  sectionForType,
  withdrawalConfirmTestId,
} from './consentManageLogic';

// ─── needsWithdrawalConfirmation ──────────────────────────────────────────────

describe('needsWithdrawalConfirmation', () => {
  it('returns true for general_health — has significant UX consequence', () => {
    expect(needsWithdrawalConfirmation('general_health')).toBe(true);
  });

  it('returns true for cloud_storage — sync stop + cloud retention copy needed', () => {
    expect(needsWithdrawalConfirmation('cloud_storage')).toBe(true);
  });

  it('returns true for infant_feeding — parental data, ม.20 care needed', () => {
    expect(needsWithdrawalConfirmation('infant_feeding')).toBe(true);
  });

  it('returns true for child_health — parental health data, ม.20+26 care needed', () => {
    expect(needsWithdrawalConfirmation('child_health')).toBe(true);
  });

  it('returns false for pdf_egress (§3.3.2 — single-feature gate, obvious off-effect)', () => {
    expect(needsWithdrawalConfirmation('pdf_egress')).toBe(false);
  });

  it('returns false for sensitive_lab_results (§3.3.2 — single-feature gate, obvious off-effect)', () => {
    expect(needsWithdrawalConfirmation('sensitive_lab_results')).toBe(false);
  });
});

// ─── SECTION_CONSENT_TYPES ───────────────────────────────────────────────────

describe('SECTION_CONSENT_TYPES', () => {
  it('core section contains only general_health (§3.3.1)', () => {
    expect(SECTION_CONSENT_TYPES.core).toEqual(['general_health']);
  });

  it('sync section contains cloud_storage, pdf_egress, sensitive_lab_results (§3.3.1)', () => {
    expect(SECTION_CONSENT_TYPES.sync).toEqual(['cloud_storage', 'pdf_egress', 'sensitive_lab_results']);
  });

  it('baby section contains infant_feeding, child_health (§3.3.1)', () => {
    expect(SECTION_CONSENT_TYPES.baby).toEqual(['infant_feeding', 'child_health']);
  });

  it('CONSENT_SECTION_ORDER has exactly 3 sections', () => {
    expect(CONSENT_SECTION_ORDER).toHaveLength(3);
  });

  it('all 6 consent types are covered exactly once across all sections', () => {
    const all = CONSENT_SECTION_ORDER.flatMap((s) => SECTION_CONSENT_TYPES[s]);
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
  });

  it('section order is core → sync → baby per the design', () => {
    expect(CONSENT_SECTION_ORDER[0]).toBe('core');
    expect(CONSENT_SECTION_ORDER[1]).toBe('sync');
    expect(CONSENT_SECTION_ORDER[2]).toBe('baby');
  });
});

// ─── sectionForType ───────────────────────────────────────────────────────────

describe('sectionForType', () => {
  it('returns core for general_health', () => {
    expect(sectionForType('general_health')).toBe('core');
  });

  it('returns sync for cloud_storage', () => {
    expect(sectionForType('cloud_storage')).toBe('sync');
  });

  it('returns sync for pdf_egress', () => {
    expect(sectionForType('pdf_egress')).toBe('sync');
  });

  it('returns sync for sensitive_lab_results', () => {
    expect(sectionForType('sensitive_lab_results')).toBe('sync');
  });

  it('returns baby for infant_feeding', () => {
    expect(sectionForType('infant_feeding')).toBe('baby');
  });

  it('returns baby for child_health', () => {
    expect(sectionForType('child_health')).toBe('baby');
  });
});

// ─── withdrawalConfirmTestId ──────────────────────────────────────────────────

describe('withdrawalConfirmTestId', () => {
  it('general_health → consent-manage-withdraw-confirm-general-health', () => {
    expect(withdrawalConfirmTestId('general_health'))
      .toBe('consent-manage-withdraw-confirm-general-health');
  });

  it('cloud_storage → consent-manage-withdraw-confirm-cloud-storage', () => {
    expect(withdrawalConfirmTestId('cloud_storage'))
      .toBe('consent-manage-withdraw-confirm-cloud-storage');
  });

  it('infant_feeding → consent-manage-withdraw-confirm-infant-feeding', () => {
    expect(withdrawalConfirmTestId('infant_feeding'))
      .toBe('consent-manage-withdraw-confirm-infant-feeding');
  });

  it('child_health → consent-manage-withdraw-confirm-child-health', () => {
    expect(withdrawalConfirmTestId('child_health'))
      .toBe('consent-manage-withdraw-confirm-child-health');
  });
});
