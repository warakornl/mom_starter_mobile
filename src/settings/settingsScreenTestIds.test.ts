/**
 * settingsScreenTestIds.test.ts — TDD contract tests for SettingsScreen testID constants.
 *
 * Rationale: SettingsScreen cannot be rendered in the node jest environment (no
 * react-native mocks).  This suite instead verifies the exported testID constants
 * that the component uses, giving E2E authors a stable, typed contract and catching
 * renames that would silently break automation.
 *
 * Consent row chevron fix (slice/fix-consent-chevron):
 *   The consent row testID constant is asserted here so any future JSX refactor that
 *   touches that row is forced to revisit the contract.
 */

import {
  SETTINGS_TESTIDS,
} from './settingsScreenTestIds';

// ─── Naming convention ────────────────────────────────────────────────────────
// All SettingsScreen testIDs follow the pattern  settings-<noun>-<action>
// so automated tests can filter by the "settings-" prefix.

describe('SETTINGS_TESTIDS — naming convention', () => {
  it('every testID starts with "settings-"', () => {
    Object.values(SETTINGS_TESTIDS).forEach((id) => {
      expect(id).toMatch(/^settings-/);
    });
  });
});

// ─── Consent row ─────────────────────────────────────────────────────────────

describe('SETTINGS_TESTIDS.manageConsentBtn', () => {
  it('is settings-manage-consent-btn', () => {
    expect(SETTINGS_TESTIDS.manageConsentBtn).toBe('settings-manage-consent-btn');
  });
});

// ─── Other row testIDs (regression guard) ────────────────────────────────────

describe('SETTINGS_TESTIDS — row completeness', () => {
  it('includes editPregnancyBtn', () => {
    expect(SETTINGS_TESTIDS.editPregnancyBtn).toBe('settings-edit-pregnancy-btn');
  });

  it('includes downloadDataBtn', () => {
    expect(SETTINGS_TESTIDS.downloadDataBtn).toBe('settings-download-data-btn');
  });

  it('includes deleteAccountBtn', () => {
    expect(SETTINGS_TESTIDS.deleteAccountBtn).toBe('settings-delete-account-btn');
  });
});
