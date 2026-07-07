/**
 * settingsScreenTestIds.ts — named testID constants for SettingsScreen.
 *
 * POST-MIGRATION (profile-tab-and-hub-ui.md §5.3 Step 3):
 *   Settings now only contains language toggle + manage-consent.
 *   The rows moved to ProfileHubScreen:
 *     - editPregnancyBtn    → PROFILE_HUB_TESTIDS.editPregnancyBtn
 *     - downloadDataBtn     → PROFILE_HUB_TESTIDS.downloadDataBtn
 *     - deleteAccountBtn    → PROFILE_HUB_TESTIDS.deleteAccountBtn
 *     - logout              → PROFILE_HUB_TESTIDS.logout
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

  /** Manage-consent row → navigates to ManageConsentsScreen (S8). */
  manageConsentBtn: 'settings-manage-consent-btn',
} as const;

export type SettingsTestId = (typeof SETTINGS_TESTIDS)[keyof typeof SETTINGS_TESTIDS];
