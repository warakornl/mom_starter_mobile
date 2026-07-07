/**
 * settingsLanguageRow.test.ts — TDD contract tests for the language row in
 * SettingsScreen (slice/feat-language-in-settings).
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
 *
 * Note: full component rendering and tap-to-toggle tests require React Native
 * Testing Library and are kept separate (the component cannot be rendered in a
 * pure-node ts-jest environment without a bundler).
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

// Stub all settings-screen dependencies that load native modules.
jest.mock('../auth/performLogout', () => ({ performLogout: jest.fn() }));
jest.mock('../sync/supplySyncStore', () => ({ supplySyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountSyncStore', () => ({ kickCountSyncStore: { reset: jest.fn() } }));
jest.mock('../sync/calendarSyncStore', () => ({ calendarSyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountDraftStore', () => ({ clearDraft: jest.fn() }));
jest.mock('../consent/consentStore', () => ({ consentStore: { reset: jest.fn() } }));
jest.mock('../consent/consentSync', () => ({ resetConsentQueue: jest.fn() }));
jest.mock('../suggestion/suggestionStore', () => ({ suggestionStore: { reset: jest.fn() } }));
jest.mock('../expenses/expensesSyncStore', () => ({ expensesSyncStore: { reset: jest.fn() } }));
jest.mock('../selfLog/selfLogSyncStore', () => ({ selfLogSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationPlanSyncStore', () => ({ medicationPlanSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationLogSyncStore', () => ({ medicationLogSyncStore: { reset: jest.fn() } }));
jest.mock('./sessionExpiredRunner', () => ({ buildSessionExpiredRunner: jest.fn() }));
jest.mock('../accountRights/exportOrchestration', () => ({ runExport: jest.fn() }));
jest.mock('../accountRights/accountApiClient', () => ({ createAccountApiClient: jest.fn() }));
jest.mock('../accountRights/accountExportFileService', () => ({
  createProductionAccountExportFileService: jest.fn(),
}));
jest.mock('../accountRights/deleteFlowLogic', () => ({ runDeleteGate: jest.fn() }));
jest.mock('../accountRights/deviceAuthAdapter', () => ({
  createRealDeviceAuthAdapter: jest.fn(),
}));
jest.mock('../accountRights/DeleteAccountSheet', () => ({
  DeleteAccountSheet: 'DeleteAccountSheet',
}));
jest.mock('../accountRights/accountRightsController', () => ({
  SESSION_EXPIRED_CODE: 'session_expired',
  isSessionExpiredCode: jest.fn(() => false),
  resolveExportOutcome: jest.fn(),
  acquireDeleteLock: jest.fn(),
  releaseDeleteLock: jest.fn(),
  mapExport401: jest.fn((x: unknown) => x),
  mapDelete401: jest.fn((x: unknown) => x),
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
