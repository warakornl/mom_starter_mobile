/**
 * ManageConsentsScreen logic — unit tests (TDD, written BEFORE implementation).
 *
 * Tests pure helpers extracted from ManageConsentsScreen:
 *   - consentTextVersion: locale → consent text version string
 *   - ALL_CONSENT_TYPES: all 7 types present (completeness; calendar_sync added as #7)
 *   - ROW_TOGGLE_TESTID: §5 naming convention check for each type
 *   - ROW_ERROR_TESTID:  §5 naming convention for error panels
 *   - PENDING_BADGE_TESTID: §5 naming convention for pending badges
 *
 * Design ref: first-run-consent.md §5 (testID table), §3.3 (screen states)
 */

import {
  consentTextVersion,
  ALL_CONSENT_TYPES,
  ROW_TOGGLE_TESTID,
  ROW_ERROR_TESTID,
  PENDING_BADGE_TESTID,
  screenStatusFromStore,
} from './manageConsentsScreenLogic';
import type { ConsentType } from '../consent/types';

// ─── consentTextVersion ───────────────────────────────────────────────────────

describe('consentTextVersion', () => {
  it('returns v1.0-th for th locale', () => {
    expect(consentTextVersion('th')).toBe('v1.0-th');
  });

  it('returns v1.0-en for en locale', () => {
    expect(consentTextVersion('en')).toBe('v1.0-en');
  });
});

// ─── ALL_CONSENT_TYPES completeness ──────────────────────────────────────────

describe('ALL_CONSENT_TYPES', () => {
  it('contains exactly 7 consent types (calendar_sync was added as #7)', () => {
    // 7 types: general_health, cloud_storage, pdf_egress, sensitive_lab_results,
    //           infant_feeding, child_health, calendar_sync
    expect(ALL_CONSENT_TYPES).toHaveLength(7);
  });

  it('includes general_health', () => {
    expect(ALL_CONSENT_TYPES).toContain('general_health');
  });

  it('includes cloud_storage', () => {
    expect(ALL_CONSENT_TYPES).toContain('cloud_storage');
  });

  it('includes pdf_egress', () => {
    expect(ALL_CONSENT_TYPES).toContain('pdf_egress');
  });

  it('includes sensitive_lab_results', () => {
    expect(ALL_CONSENT_TYPES).toContain('sensitive_lab_results');
  });

  it('includes infant_feeding', () => {
    expect(ALL_CONSENT_TYPES).toContain('infant_feeding');
  });

  it('includes child_health', () => {
    expect(ALL_CONSENT_TYPES).toContain('child_health');
  });

  it('includes calendar_sync (#7 — device calendar sync feature)', () => {
    expect(ALL_CONSENT_TYPES).toContain('calendar_sync');
  });
});

// ─── ROW_TOGGLE_TESTID §5 naming ─────────────────────────────────────────────

describe('ROW_TOGGLE_TESTID', () => {
  it('has an entry for every ConsentType', () => {
    const allKeys = Object.keys(ROW_TOGGLE_TESTID) as ConsentType[];
    expect(allKeys.sort()).toEqual([...ALL_CONSENT_TYPES].sort());
  });

  it('general_health testID follows §5 convention', () => {
    expect(ROW_TOGGLE_TESTID['general_health']).toBe('consent-manage-toggle-general-health');
  });

  it('cloud_storage testID follows §5 convention', () => {
    expect(ROW_TOGGLE_TESTID['cloud_storage']).toBe('consent-manage-toggle-cloud-storage');
  });

  it('pdf_egress testID follows §5 convention', () => {
    expect(ROW_TOGGLE_TESTID['pdf_egress']).toBe('consent-manage-toggle-pdf-egress');
  });

  it('sensitive_lab_results testID follows §5 convention', () => {
    expect(ROW_TOGGLE_TESTID['sensitive_lab_results']).toBe('consent-manage-toggle-sensitive-lab');
  });

  it('infant_feeding testID follows §5 convention', () => {
    expect(ROW_TOGGLE_TESTID['infant_feeding']).toBe('consent-manage-toggle-infant-feeding');
  });

  it('child_health testID follows §5 convention', () => {
    expect(ROW_TOGGLE_TESTID['child_health']).toBe('consent-manage-toggle-child-health');
  });
});

// ─── ROW_ERROR_TESTID §5 naming ───────────────────────────────────────────────

describe('ROW_ERROR_TESTID', () => {
  it('has an entry for every ConsentType', () => {
    const allKeys = Object.keys(ROW_ERROR_TESTID) as ConsentType[];
    expect(allKeys.sort()).toEqual([...ALL_CONSENT_TYPES].sort());
  });

  it('general_health error testID follows §5 convention', () => {
    expect(ROW_ERROR_TESTID['general_health']).toBe('consent-manage-row-error-general-health');
  });

  it('sensitive_lab_results error testID uses short form', () => {
    expect(ROW_ERROR_TESTID['sensitive_lab_results']).toBe('consent-manage-row-error-sensitive-lab');
  });

  it('infant_feeding error testID follows §5 convention', () => {
    expect(ROW_ERROR_TESTID['infant_feeding']).toBe('consent-manage-row-error-infant-feeding');
  });

  it('child_health error testID follows §5 convention', () => {
    expect(ROW_ERROR_TESTID['child_health']).toBe('consent-manage-row-error-child-health');
  });
});

// ─── PENDING_BADGE_TESTID §5 naming ──────────────────────────────────────────

describe('PENDING_BADGE_TESTID', () => {
  it('has an entry for every ConsentType', () => {
    const allKeys = Object.keys(PENDING_BADGE_TESTID) as ConsentType[];
    expect(allKeys.sort()).toEqual([...ALL_CONSENT_TYPES].sort());
  });

  it('general_health badge testID preserves underscore (§5)', () => {
    // §5: badge testIDs use the consent type name as-is (underscores, not hyphens)
    expect(PENDING_BADGE_TESTID['general_health']).toBe(
      'consent-manage-pending-sync-badge-general_health',
    );
  });

  it('sensitive_lab_results badge testID preserves underscore', () => {
    expect(PENDING_BADGE_TESTID['sensitive_lab_results']).toBe(
      'consent-manage-pending-sync-badge-sensitive_lab_results',
    );
  });

  it('infant_feeding badge testID preserves underscore', () => {
    expect(PENDING_BADGE_TESTID['infant_feeding']).toBe(
      'consent-manage-pending-sync-badge-infant_feeding',
    );
  });
});

// ─── screenStatusFromStore ────────────────────────────────────────────────────

describe('screenStatusFromStore', () => {
  it('returns loaded when store has data (no spinner on open §3.3.0)', () => {
    const hasData = true;
    expect(screenStatusFromStore(hasData)).toBe('loaded');
  });

  it('returns skeleton when store is empty (§3.3.0 — triggers GET)', () => {
    const hasData = false;
    expect(screenStatusFromStore(hasData)).toBe('skeleton');
  });
});
