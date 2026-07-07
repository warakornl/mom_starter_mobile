/**
 * settingsScreenTestIds.ts — named testID constants for SettingsScreen.
 *
 * Centralises the testID strings used in SettingsScreen.tsx so that:
 *   - The test suite can assert the naming contract without rendering the component.
 *   - E2E / integration tests import a stable typed constant rather than raw strings.
 *   - Any future rename is a single-point change caught at compile time.
 *
 * Convention: all IDs follow the pattern  settings-<noun>-<action>  so automation
 * can filter by the "settings-" prefix.
 */

export const SETTINGS_TESTIDS = {
  /** The root SafeAreaView of SettingsScreen. */
  screen: 'settings-screen',

  /**
   * Language-selector row in the General section (feat-language-in-settings).
   * Shows the current language value on the right; toggles TH↔EN on tap.
   */
  languageBtn: 'settings-language-btn',

  /** Edit-pregnancy row (shown only when lifecycle=pregnant, AC-2). */
  editPregnancyBtn: 'settings-edit-pregnancy-btn',

  /** Manage-consent row → navigates to ManageConsentsScreen (S8). */
  manageConsentBtn: 'settings-manage-consent-btn',

  /** Download-my-data row (PDPA ม.30/31 data-export). */
  downloadDataBtn: 'settings-download-data-btn',

  /** Activity spinner shown while export is in-progress. */
  downloadSpinner: 'settings-download-spinner',

  /** Inline error card shown after a failed export (§2.3). */
  exportErrorCard: 'settings-export-error-card',

  /** Retry button inside the export error card. */
  exportRetryBtn: 'settings-export-retry-btn',

  /** Dismiss button inside the export error card. */
  exportDismissBtn: 'settings-export-dismiss-btn',

  /** Terminal "unavailable" notice shown when export returns 404 (§2.4). */
  export404Notice: 'settings-export-404-notice',

  /** Back button inside the export-404 notice. */
  export404BackBtn: 'settings-export-404-back-btn',

  /** Logout button. */
  logout: 'settings-logout',

  /** Delete-account button → opens DeleteAccountSheet. */
  deleteAccountBtn: 'settings-delete-account-btn',
} as const;

export type SettingsTestId = (typeof SETTINGS_TESTIDS)[keyof typeof SETTINGS_TESTIDS];
