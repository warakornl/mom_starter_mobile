/**
 * privacyPolicyAndConsentHistoryReachability.test.ts — TDD guard for task #40
 * (dead-link fix on ManageConsentsScreen's footer).
 *
 * Verifies PrivacyPolicy + ConsentHistory are REACHABLE:
 *
 *   ManageConsentsScreen (footer policy_link / history_link rows)
 *     → RootNavigator (onNavigatePrivacyPolicy / onNavigateConsentHistory callbacks)
 *     → Stack.Screen name="PrivacyPolicy" / name="ConsentHistory"
 *     → PrivacyPolicyScreen / ConsentHistoryScreen
 *
 * This test FAILS if any link in the chain is removed — same regression
 * class as the B1 PregnancySummary dead-feature bug (screen existed, route
 * missing) and the ORIGINAL bug here (footer link existed, NO route NO
 * onPress at all — a fully-dead, misleading affordance).
 *
 * Approach: pure-node source inspection (same pattern as
 * pregnancySummaryReachability.test.ts / autoDecrementReachability.test.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RootStackParamList } from './types';

// ─── Source files under test ──────────────────────────────────────────────────

const ROOT_NAVIGATOR_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

const NAV_TYPES_SRC = fs.readFileSync(
  path.join(__dirname, 'types.ts'),
  'utf8',
);

const MANAGE_CONSENTS_SRC = fs.readFileSync(
  path.join(__dirname, '../screens/ManageConsentsScreen.tsx'),
  'utf8',
);

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractScreenBlock(src: string, screenName: string): string {
  const marker = `name="${screenName}"`;
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) return '';
  const endMarker = '</Stack.Screen>';
  const endIdx = src.indexOf(endMarker, startIdx);
  if (endIdx === -1) return src.slice(startIdx);
  return src.slice(startIdx, endIdx + endMarker.length);
}

// ─── A: Routes registered in RootStackParamList (types.ts) ───────────────────

describe('[#40 Reachability] PrivacyPolicy + ConsentHistory routes in RootStackParamList', () => {
  it('types.ts declares PrivacyPolicy in RootStackParamList', () => {
    expect(NAV_TYPES_SRC).toContain('PrivacyPolicy');
  });

  it('types.ts declares ConsentHistory in RootStackParamList', () => {
    expect(NAV_TYPES_SRC).toContain('ConsentHistory');
  });

  it('PrivacyPolicy route params are undefined (no health/PII in params)', () => {
    expect(NAV_TYPES_SRC).toContain('PrivacyPolicy: undefined');
  });

  it('ConsentHistory route params are undefined (SD-9: fetch on the target screen)', () => {
    expect(NAV_TYPES_SRC).toContain('ConsentHistory: undefined');
  });

  it('TypeScript keys exist in RootStackParamList (compile-time proof)', () => {
    type HasPrivacyPolicy = 'PrivacyPolicy' extends keyof RootStackParamList ? true : false;
    type HasConsentHistory = 'ConsentHistory' extends keyof RootStackParamList ? true : false;
    const checkA: HasPrivacyPolicy = true;
    const checkB: HasConsentHistory = true;
    expect(checkA).toBe(true);
    expect(checkB).toBe(true);
  });
});

// ─── B: Screens registered in RootNavigator ───────────────────────────────────

describe('[#40 Reachability] PrivacyPolicy + ConsentHistory registered as Stack.Screens', () => {
  it('RootNavigator.tsx imports PrivacyPolicyScreen', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('PrivacyPolicyScreen');
  });

  it('RootNavigator.tsx imports ConsentHistoryScreen', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('ConsentHistoryScreen');
  });

  it('RootNavigator.tsx has a Stack.Screen with name="PrivacyPolicy"', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('name="PrivacyPolicy"');
  });

  it('RootNavigator.tsx has a Stack.Screen with name="ConsentHistory"', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('name="ConsentHistory"');
  });

  it('ManageConsents registration wires onNavigatePrivacyPolicy to navigate("PrivacyPolicy")', () => {
    const block = extractScreenBlock(ROOT_NAVIGATOR_SRC, 'ManageConsents');
    expect(block).toContain('onNavigatePrivacyPolicy');
    expect(block).toContain("navigate('PrivacyPolicy')");
  });

  it('ManageConsents registration wires onNavigateConsentHistory to navigate("ConsentHistory")', () => {
    const block = extractScreenBlock(ROOT_NAVIGATOR_SRC, 'ManageConsents');
    expect(block).toContain('onNavigateConsentHistory');
    expect(block).toContain("navigate('ConsentHistory')");
  });
});

// ─── C: ManageConsentsScreen wires the callbacks to real interactive rows ─────

describe('[#40 Reachability] ManageConsentsScreen footer rows become real links', () => {
  it('accepts onNavigatePrivacyPolicy + onNavigateConsentHistory props', () => {
    expect(MANAGE_CONSENTS_SRC).toContain('onNavigatePrivacyPolicy');
    expect(MANAGE_CONSENTS_SRC).toContain('onNavigateConsentHistory');
  });

  it('policy-link row uses accessibilityRole="link" + onPress={onNavigatePrivacyPolicy} when wired', () => {
    expect(MANAGE_CONSENTS_SRC).toMatch(/onPress={onNavigatePrivacyPolicy}/);
    expect(MANAGE_CONSENTS_SRC).toMatch(/accessibilityRole="link"/);
  });

  it('history-link row uses accessibilityRole="link" + onPress={onNavigateConsentHistory} when wired', () => {
    expect(MANAGE_CONSENTS_SRC).toMatch(/onPress={onNavigateConsentHistory}/);
  });

  it('testIDs consent-manage-policy-link / consent-manage-history-link are preserved', () => {
    expect(MANAGE_CONSENTS_SRC).toContain('consent-manage-policy-link');
    expect(MANAGE_CONSENTS_SRC).toContain('consent-manage-history-link');
  });
});
