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

  it('returns true for calendar_sync — withdrawal shows disable dialog (delete/keep events)', () => {
    // calendar_sync withdrawal has a significant consequence: the app must ask
    // whether to DELETE or KEEP events already written to device calendar.
    // This requires the confirmation sheet (handled by CalendarSyncSettingsScreen,
    // not the generic ManageConsents withdrawal sheet).
    expect(needsWithdrawalConfirmation('calendar_sync')).toBe(true);
  });
});

// ─── SECTION_CONSENT_TYPES ───────────────────────────────────────────────────

describe('SECTION_CONSENT_TYPES', () => {
  it('core section contains only general_health (§3.3.1)', () => {
    expect(SECTION_CONSENT_TYPES.core).toEqual(['general_health']);
  });

  it('sync section contains cloud_storage, pdf_egress, sensitive_lab_results, calendar_sync (§3.3.1 + calendar-sync feature)', () => {
    // calendar_sync (#7) was added to the sync section alongside cloud_storage.
    // Its toggle-on path navigates to CalendarSyncConsentSheet (explainer-before-prompt).
    expect(SECTION_CONSENT_TYPES.sync).toEqual([
      'cloud_storage',
      'pdf_egress',
      'sensitive_lab_results',
      'calendar_sync',
    ]);
  });

  it('baby section contains infant_feeding, child_health (§3.3.1)', () => {
    expect(SECTION_CONSENT_TYPES.baby).toEqual(['infant_feeding', 'child_health']);
  });

  it('CONSENT_SECTION_ORDER has exactly 3 sections', () => {
    expect(CONSENT_SECTION_ORDER).toHaveLength(3);
  });

  it('all 7 consent types are covered exactly once across all sections (calendar_sync is #7)', () => {
    const all = CONSENT_SECTION_ORDER.flatMap((s) => SECTION_CONSENT_TYPES[s]);
    // 7 types: general_health, cloud_storage, pdf_egress, sensitive_lab_results,
    //           infant_feeding, child_health, calendar_sync
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect(all).toContain('calendar_sync');
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

  it('returns sync for calendar_sync (#7 — lives in sync section)', () => {
    expect(sectionForType('calendar_sync')).toBe('sync');
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
