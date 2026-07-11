/**
 * manageConsentsScreenLogic — pure helpers for ManageConsentsScreen (S8).
 *
 * Extracted here so they can be unit-tested without importing React Native.
 *
 * Design ref: first-run-consent.md §3.3, §5 (testID table)
 *
 * No React imports — fully testable in node environment.
 */

import type { ConsentType } from '../consent/types';
import type { Locale } from '../auth/types';

// ─── Screen status type ───────────────────────────────────────────────────────

export type ScreenStatus = 'skeleton' | 'loaded' | 'error';

// ─── All 6 consent types (complete set, ordered by section) ──────────────────

export const ALL_CONSENT_TYPES: ConsentType[] = [
  'general_health',
  'cloud_storage',
  'pdf_egress',
  'sensitive_lab_results',
  'infant_feeding',
  'child_health',
  'calendar_sync',
];

// ─── Consent text version ─────────────────────────────────────────────────────

/**
 * Maps locale to consent text version string for the POST body.
 * Used so the server can record which language version was presented.
 */
export function consentTextVersion(locale: Locale): string {
  return locale === 'en' ? 'v1.0-en' : 'v1.0-th';
}

// ─── Screen status initializer ────────────────────────────────────────────────

/**
 * Determines the initial screen status based on whether the local store has data.
 *
 * §3.3.0: No spinner on open when store is already populated.
 *   hasData=true  → 'loaded'  (render list immediately from local store)
 *   hasData=false → 'skeleton' (render skeleton + trigger GET /account/consents)
 */
export function screenStatusFromStore(hasData: boolean): ScreenStatus {
  return hasData ? 'loaded' : 'skeleton';
}

// ─── testID maps — §5 first-run-consent.md ───────────────────────────────────

/**
 * testIDs for consent row toggle switches.
 * §5: consent-manage-toggle-{type-with-hyphens}
 * Note: sensitive_lab_results uses short form 'sensitive-lab' per §5.
 */
export const ROW_TOGGLE_TESTID: Record<ConsentType, string> = {
  general_health:        'consent-manage-toggle-general-health',
  cloud_storage:         'consent-manage-toggle-cloud-storage',
  pdf_egress:            'consent-manage-toggle-pdf-egress',
  sensitive_lab_results: 'consent-manage-toggle-sensitive-lab',
  infant_feeding:        'consent-manage-toggle-infant-feeding',
  child_health:          'consent-manage-toggle-child-health',
  calendar_sync:         'consent-manage-toggle-calendar-sync',
};

/**
 * testIDs for per-row error panels.
 * §5: consent-manage-row-error-{type-with-hyphens}
 */
export const ROW_ERROR_TESTID: Record<ConsentType, string> = {
  general_health:        'consent-manage-row-error-general-health',
  cloud_storage:         'consent-manage-row-error-cloud-storage',
  pdf_egress:            'consent-manage-row-error-pdf-egress',
  sensitive_lab_results: 'consent-manage-row-error-sensitive-lab',
  infant_feeding:        'consent-manage-row-error-infant-feeding',
  child_health:          'consent-manage-row-error-child-health',
  calendar_sync:         'consent-manage-row-error-calendar-sync',
};

/**
 * testIDs for pending-sync badges.
 * §5: consent-manage-pending-sync-badge-{type} — uses the ConsentType name
 * as-is (with underscores, NOT hyphens), since the spec quotes underscore form.
 */
export const PENDING_BADGE_TESTID: Record<ConsentType, string> = {
  general_health:        'consent-manage-pending-sync-badge-general_health',
  cloud_storage:         'consent-manage-pending-sync-badge-cloud_storage',
  pdf_egress:            'consent-manage-pending-sync-badge-pdf_egress',
  sensitive_lab_results: 'consent-manage-pending-sync-badge-sensitive_lab_results',
  infant_feeding:        'consent-manage-pending-sync-badge-infant_feeding',
  child_health:          'consent-manage-pending-sync-badge-child_health',
  calendar_sync:         'consent-manage-pending-sync-badge-calendar_sync',
};

/**
 * testIDs for clickable rows.
 * §5: consent-manage-row-{type-with-hyphens}
 */
export const ROW_TESTID: Record<ConsentType, string> = {
  general_health:        'consent-manage-row-general-health',
  cloud_storage:         'consent-manage-row-cloud-storage',
  pdf_egress:            'consent-manage-row-pdf-egress',
  sensitive_lab_results: 'consent-manage-row-sensitive-lab',
  infant_feeding:        'consent-manage-row-infant-feeding',
  child_health:          'consent-manage-row-child-health',
  calendar_sync:         'consent-manage-row-calendar-sync',
};
