/**
 * settingsLanguageRow.test.ts — TDD contract tests for the language row in
 * SettingsScreen (slice/feat-language-in-settings).
 *
 * POST-MIGRATION (profile-tab-and-hub-ui.md §5.3):
 *   Settings now only contains language toggle + manage-consent.
 *   Export/delete/logout/editPregnancy rows moved to ProfileHubScreen.
 *   Mocks for those dependencies are removed.
 *
 * These tests cover three aspects that can run in the pure-node jest environment:
 *
 *  1. SETTINGS_TESTIDS has a `languageBtn` constant that follows the naming
 *     convention (settings-<noun>-<action>).
 *
 *  2. The messages catalog carries the four new keys required by the language row:
 *       settings.general       — section label "ทั่วไป" / "General"
 *       settings.language      — row label "ภาษา / Language"
 *       settings.languageValueTh — displayed value when locale=th  ("ไทย")
 *       settings.languageValueEn — displayed value when locale=en  ("English")
 *     Both th and en catalog entries must be non-empty strings.
 *
 *  3. SettingsScreen module exports a named component function (structural smoke
 *     test — follows the homeTabScreen.snapshotPath.test.ts pattern).
 */

// ─── React Native stubs (required before SettingsScreen import) ───────────────

jest.mock('react-native', () => {
  const StyleSheet = { create: (obj: unknown) => obj };
  const mkComponent = (name: string) => name;
  return {
    View: mkComponent('View'),
    Text: mkComponent('Text'),
    TouchableOpacity: mkComponent('TouchableOpacity'),
    SafeAreaView: mkComponent('SafeAreaView'),
    ScrollView: mkComponent('ScrollView'),
    Alert: { alert: jest.fn() },
    StyleSheet,
    Platform: { OS: 'ios', Version: '17.0' },
    ActivityIndicator: mkComponent('ActivityIndicator'),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { SETTINGS_TESTIDS } from './settingsScreenTestIds';
import { catalog } from '../i18n/messages';
import { SettingsScreen } from './SettingsScreen';

// ─── 1. SETTINGS_TESTIDS.languageBtn ─────────────────────────────────────────

describe('SETTINGS_TESTIDS.languageBtn — naming contract', () => {
  it('exists and equals settings-language-btn', () => {
    expect(SETTINGS_TESTIDS.languageBtn).toBe('settings-language-btn');
  });

  it('follows the settings-<noun>-<verb> naming convention', () => {
    expect(SETTINGS_TESTIDS.languageBtn).toMatch(/^settings-/);
  });
});

// ─── 2. i18n catalog keys for the language row ───────────────────────────────

describe('catalog — settings language-row keys', () => {
  const REQUIRED_KEYS = [
    'settings.general',
    'settings.language',
    'settings.languageValueTh',
    'settings.languageValueEn',
  ] as const;

  it('has all four language-row keys with non-empty Thai values', () => {
    for (const key of REQUIRED_KEYS) {
      const val = catalog.th[key];
      expect(val).toBeTruthy();
      expect(typeof val).toBe('string');
    }
  });

  it('has all four language-row keys with non-empty English values', () => {
    for (const key of REQUIRED_KEYS) {
      const val = catalog.en[key];
      expect(val).toBeTruthy();
      expect(typeof val).toBe('string');
    }
  });

  it('settings.languageValueTh (th) contains ไทย', () => {
    expect(catalog.th['settings.languageValueTh']).toContain('ไทย');
  });

  it('settings.languageValueEn (en) contains English', () => {
    expect(catalog.en['settings.languageValueEn']).toContain('English');
  });
});

// ─── 3. SettingsScreen module smoke test ─────────────────────────────────────

describe('SettingsScreen — module export (structural smoke test)', () => {
  it('is exported as a function (React component)', () => {
    expect(typeof SettingsScreen).toBe('function');
  });

  it('is defined', () => {
    expect(SettingsScreen).toBeDefined();
  });
});
