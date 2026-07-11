/**
 * consentManageLogic — pure logic for the S8 Manage-Consents screen.
 *
 * Design ref: first-run-consent.md §3.3, §3.3.2
 *
 * Exports:
 *   CONSENT_SECTION_ORDER  — display order of sections
 *   SECTION_CONSENT_TYPES  — consent types in each section
 *   needsWithdrawalConfirmation — determines if a confirmation sheet is needed
 *   sectionForType         — finds which section a type belongs to
 *   withdrawalConfirmTestId — testID for a type's withdrawal confirmation sheet
 *
 * PDPA note: ม.19 requires withdrawal to be as easy as granting. This module
 * supports that by providing the gate-less toggle toggle-off path for
 * pdf_egress and sensitive_lab_results (obvious, single-feature consequence),
 * and the confirmation-sheet path for types where consequences need explanation.
 *
 * No React imports — pure TypeScript functions are fully testable without RN.
 */

import type { ConsentType } from './types';

// ─── Section types ────────────────────────────────────────────────────────────

/** The three UI sections in the S8 Manage-Consents list (§3.3.1). */
export type ConsentSection = 'core' | 'sync' | 'baby';

/**
 * Display order of sections in S8 (§3.3.1).
 * Matches: Core → Sync & reports → Baby data
 */
export const CONSENT_SECTION_ORDER: ConsentSection[] = ['core', 'sync', 'baby'];

/**
 * Consent types in each section, in display order (§3.3.1).
 * i18n section header keys: consent.manage.section.{section}
 */
export const SECTION_CONSENT_TYPES: Record<ConsentSection, ConsentType[]> = {
  core: ['general_health'],
  // calendar_sync (#7): device-calendar sync; toggle-on → CalendarSyncConsentSheet
  // (explainer-before-prompt, CAL-SCR-10); toggle-off → CalendarSync disable dialog
  sync: ['cloud_storage', 'pdf_egress', 'sensitive_lab_results', 'calendar_sync'],
  baby: ['infant_feeding', 'child_health'],
};

// ─── Withdrawal confirmation rules ────────────────────────────────────────────

/**
 * Returns true if toggling this consent type OFF must show a confirmation
 * sheet before executing the withdrawal POST (§3.3.2).
 *
 * pdf_egress and sensitive_lab_results are single-feature gates with an obvious
 * off-effect ("PDF creation disabled"), so the design explicitly skips the
 * confirmation sheet for them. All other types need it.
 */
export function needsWithdrawalConfirmation(type: ConsentType): boolean {
  return type !== 'pdf_egress' && type !== 'sensitive_lab_results';
}

// ─── Section lookup ───────────────────────────────────────────────────────────

/**
 * Returns the ConsentSection that contains the given type.
 * Every valid ConsentType maps to exactly one section.
 */
export function sectionForType(type: ConsentType): ConsentSection {
  for (const section of CONSENT_SECTION_ORDER) {
    if (SECTION_CONSENT_TYPES[section].includes(type)) {
      return section;
    }
  }
  // Defensive fallback — should never be reached with a valid ConsentType
  return 'sync';
}

// ─── testID helpers ───────────────────────────────────────────────────────────

/**
 * Returns the testID for the withdrawal-confirmation bottom sheet of a
 * given consent type (§5 first-run-consent.md testID table).
 *
 * Used on the `testID` prop of the Modal / sheet wrapper in ManageConsentsScreen.
 * Only meaningful for types where needsWithdrawalConfirmation returns true.
 */
export function withdrawalConfirmTestId(type: ConsentType): string {
  const ids: Partial<Record<ConsentType, string>> = {
    general_health: 'consent-manage-withdraw-confirm-general-health',
    cloud_storage:  'consent-manage-withdraw-confirm-cloud-storage',
    infant_feeding: 'consent-manage-withdraw-confirm-infant-feeding',
    child_health:   'consent-manage-withdraw-confirm-child-health',
  };
  return ids[type] ?? `consent-manage-withdraw-confirm-${type}`;
}
