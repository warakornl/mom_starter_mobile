/**
 * settingsScreenTestIds.test.ts — TDD contract tests for SettingsScreen testID constants.
 *
 * POST-MIGRATION (profile-tab-and-hub-ui.md §5.3 Step 3):
 *   Settings now only contains language + manage-consent rows.
 *   Rows that moved to ProfileHubScreen:
 *     editPregnancyBtn → PROFILE_HUB_TESTIDS.editPregnancyBtn
 *     downloadDataBtn  → PROFILE_HUB_TESTIDS.downloadDataBtn
 *     deleteAccountBtn → PROFILE_HUB_TESTIDS.deleteAccountBtn
 *     logout           → PROFILE_HUB_TESTIDS.logout
 *
 * Rationale: SettingsScreen cannot be rendered in the node jest environment.
 * This suite instead verifies the exported testID constants so E2E authors have
 * a stable, typed contract and any rename is caught at compile time.
 */

import { SETTINGS_TESTIDS } from './settingsScreenTestIds';
import { PROFILE_HUB_TESTIDS } from '../profile/profileHubTestIds';

// ─── Naming convention ────────────────────────────────────────────────────────

describe('SETTINGS_TESTIDS — naming convention', () => {
  it('every testID starts with "settings-"', () => {
    Object.values(SETTINGS_TESTIDS).forEach((id) => {
      expect(id).toMatch(/^settings-/);
    });
  });
});

// ─── Language row ─────────────────────────────────────────────────────────────

describe('SETTINGS_TESTIDS.languageBtn', () => {
  it('is settings-language-btn', () => {
    expect(SETTINGS_TESTIDS.languageBtn).toBe('settings-language-btn');
  });
});

// ─── Consent row ─────────────────────────────────────────────────────────────

describe('SETTINGS_TESTIDS.manageConsentBtn', () => {
  it('is settings-manage-consent-btn', () => {
    expect(SETTINGS_TESTIDS.manageConsentBtn).toBe('settings-manage-consent-btn');
  });
});

// ─── Migrated rows are now in ProfileHub ─────────────────────────────────────
// These assertions confirm where the moved rows live — prevents regressions
// where a row would be silently deleted from both screens.

describe('PROFILE_HUB_TESTIDS — migrated rows from Settings (§5.3)', () => {
  it('PROFILE_HUB_TESTIDS has editPregnancyBtn (moved from Settings)', () => {
    expect(PROFILE_HUB_TESTIDS.editPregnancyBtn).toBe('profile-hub-edit-pregnancy-btn');
  });

  it('PROFILE_HUB_TESTIDS has downloadDataBtn (moved from Settings)', () => {
    expect(PROFILE_HUB_TESTIDS.downloadDataBtn).toBe('profile-hub-download-data-btn');
  });

  it('PROFILE_HUB_TESTIDS has deleteAccountBtn (moved from Settings)', () => {
    expect(PROFILE_HUB_TESTIDS.deleteAccountBtn).toBe('profile-hub-delete-account-btn');
  });

  it('PROFILE_HUB_TESTIDS has logout (moved from Settings)', () => {
    expect(PROFILE_HUB_TESTIDS.logout).toBe('profile-hub-logout');
  });
});

// ─── PROFILE_HUB_TESTIDS naming convention ────────────────────────────────────

describe('PROFILE_HUB_TESTIDS — naming convention', () => {
  it('every testID starts with "profile-hub-"', () => {
    Object.values(PROFILE_HUB_TESTIDS).forEach((id) => {
      expect(id).toMatch(/^profile-hub-/);
    });
  });
});
