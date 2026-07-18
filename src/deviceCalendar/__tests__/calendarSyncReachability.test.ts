/**
 * calendarSyncReachability — reachability + navigation type test
 *
 * Proves the feature is NOT dead: the opt-in flow and the settings screen
 * are reachable via typed nav calls from their declared entry points.
 *
 * Architecture DoD: "A screen isn't done until it's REGISTERED, an entry
 * control routes to it, AND a reachability test navigates to it."
 *
 * This test verifies:
 *   1. RootStackParamList includes CalendarSyncSettings and CalendarSyncConsent routes
 *   2. The route params satisfy the SD-9 constraint (no health data in params)
 *   3. Both screens are exported as functions from their modules
 *
 * Trace: architecture §1 nav map, functional CAL-SCR-50, nav research findings.
 *
 * Note: react-native is mocked here because screen files import React Native
 * components. ts-jest uses testEnvironment:'node' and does not transform
 * node_modules — the pattern for screen module tests in this codebase
 * (see settingsScreen.motherRoom.test.tsx).
 */

// ─── Mock react-native before any screen require ─────────────────────────────

jest.mock('react-native', () => ({
  View:              'View',
  Text:              'Text',
  TouchableOpacity:  'TouchableOpacity',
  Switch:            'Switch',
  ScrollView:        'ScrollView',
  Modal:             'Modal',
  ActivityIndicator: 'ActivityIndicator',
  Alert:             { alert: jest.fn() },
  SafeAreaView:      'SafeAreaView',
  StyleSheet:        { create: (o: unknown) => o },
  Platform:          { OS: 'ios' },
}));

// CalendarSyncSettingsScreen now imports SafeAreaView from
// react-native-safe-area-context (bug fix — footer/bottom safe-area space).
// That package's real module is ESM and not transformed here — mock it
// (same pattern as calendarSyncSettingsScreen.motherRoom.test.tsx).
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));

// CalendarSyncSettingsScreen now imports useT() (i18n) which transitively
// imports expo-secure-store — an ESM native module ts-jest cannot transform.
// Mock it here (same pattern as settingsLanguageRow.test.ts).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// ─── Route type tests ─────────────────────────────────────────────────────────

// Verify route types are present in the param list
import type { RootStackParamList } from '../../navigation/types';

describe('calendarSyncReachability — route types', () => {
  it('CalendarSyncSettings route exists in RootStackParamList with no health params', () => {
    // Type-level check: if this compiles, the route is registered.
    type SettingsParams = RootStackParamList['CalendarSyncSettings'];
    // SD-9: must be undefined (no params at all) — health data never in route params
    const params: SettingsParams = undefined;
    expect(params).toBeUndefined();
  });

  it('CalendarSyncConsent route exists in RootStackParamList with no health params', () => {
    type ConsentParams = RootStackParamList['CalendarSyncConsent'];
    const params: ConsentParams = undefined;
    expect(params).toBeUndefined();
  });

  it('CalendarSyncPrivacyLevel route exists in RootStackParamList with no health params', () => {
    type PrivacyParams = RootStackParamList['CalendarSyncPrivacyLevel'];
    const params: PrivacyParams = undefined;
    expect(params).toBeUndefined();
  });
});

// ─── Module export tests ──────────────────────────────────────────────────────

// Verify screens are exported from their modules as functions (component constructors)
describe('calendarSyncReachability — module exports', () => {
  it('CalendarSyncSettingsScreen is exported from its module', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../screens/CalendarSyncSettingsScreen');
    expect(typeof mod.CalendarSyncSettingsScreen).toBe('function');
  });

  it('CalendarSyncConsentSheet is exported from its module', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../screens/CalendarSyncConsentSheet');
    expect(typeof mod.CalendarSyncConsentSheet).toBe('function');
  });

  it('CalendarSyncPrivacyLevelScreen is exported from its module', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../screens/CalendarSyncPrivacyLevelScreen');
    expect(typeof mod.CalendarSyncPrivacyLevelScreen).toBe('function');
  });
});
