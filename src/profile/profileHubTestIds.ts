/**
 * profileHubTestIds.ts — named testID constants for ProfileHubScreen.
 *
 * All IDs follow the pattern  profile-hub-<noun>-<action>  so automation
 * can filter by the "profile-hub-" prefix.
 */

export const PROFILE_HUB_TESTIDS = {
  /** Root SafeAreaView of ProfileHubScreen. */
  screen: 'profile-hub-screen',

  /** Inline header bar title text (§1 feat-profile-header-settings-row). */
  screenHeader: 'profile-hub-header',

  /** Settings navigation row — opens SettingsScreen (§2 feat-profile-header-settings-row). */
  settingsBtn: 'profile-hub-settings-btn',

  /** Edit-pregnancy row (shown only when lifecycle=pregnant). */
  editPregnancyBtn: 'profile-hub-edit-pregnancy-btn',

  /**
   * Edit personal info row — lifecycle-agnostic (pregnant AND postpartum).
   * Navigates to ProfileInfoEditScreen to edit mother first/last name + baby name.
   * Spec: profile-tab-and-hub-ui.md §3.4 / name-fields-design.md §3.4
   */
  editPersonalInfoBtn: 'profile-hub-edit-personal-info-btn',

  /** Download-my-data row (PDPA ม.30). */
  downloadDataBtn: 'profile-hub-download-data-btn',

  /** Activity spinner shown while export is in-progress. */
  downloadSpinner: 'profile-hub-download-spinner',

  /** Inline error card shown after a failed export. */
  exportErrorCard: 'profile-hub-export-error-card',

  /** Retry button inside the export error card. */
  exportRetryBtn: 'profile-hub-export-retry-btn',

  /** Dismiss button inside the export error card. */
  exportDismissBtn: 'profile-hub-export-dismiss-btn',

  /** Terminal "unavailable" notice shown when export returns 404. */
  export404Notice: 'profile-hub-export-404-notice',

  /** Back button inside the export-404 notice. */
  export404BackBtn: 'profile-hub-export-404-back-btn',

  /** Logout row (§3.6 spec testID). */
  logout: 'profile-hub-logout',

  /** Delete-account row → opens DeleteAccountSheet. */
  deleteAccountBtn: 'profile-hub-delete-account-btn',

  /** Profile summary card (not interactive — informational). */
  summaryCard: 'profile-hub-summary-card',
} as const;

export type ProfileHubTestId = (typeof PROFILE_HUB_TESTIDS)[keyof typeof PROFILE_HUB_TESTIDS];
