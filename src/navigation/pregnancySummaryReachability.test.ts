/**
 * pregnancySummaryReachability.test.ts — TDD guard for B1 (dead-feature fix).
 *
 * Verifies that PregnancySummaryScreen is REACHABLE via the ProfileHub row:
 *
 *   ProfileHubScreen (pregnancySummaryBtn row)
 *     → BottomTabNavigator (onPregnancySummary handler)
 *     → RootNavigator (Stack.Screen name="PregnancySummary")
 *     → PregnancySummaryWrapper (GET on mount — SD-9-safe)
 *     → PregnancySummaryScreen (receives decoded health data, NOT route params)
 *
 * This test FAILS if any link in the chain is removed (regression guard for the
 * dead-feature regression: screen + ProfileHub row existed but were unreachable).
 *
 * Approach: pure-node source inspection (no RNTL; same pattern as
 * doctorReportRouteOptions.test.ts and PregnancySummaryScreen.test.ts).
 *
 * SD-9: asserts route params are `undefined` — health data MUST NOT go in route
 * params. The screen must obtain edd/birthDate/deliveryType/hospitalDates via
 * GET on mount (mirror of ProfileInfoEditScreen pattern).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RootStackParamList } from './types';

// ─── Source files under test ──────────────────────────────────────────────────

const ROOT_NAVIGATOR_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

const BOTTOM_TAB_SRC = fs.readFileSync(
  path.join(__dirname, 'BottomTabNavigator.tsx'),
  'utf8',
);

const NAV_TYPES_SRC = fs.readFileSync(
  path.join(__dirname, 'types.ts'),
  'utf8',
);

const PROFILE_HUB_SRC = fs.readFileSync(
  path.join(__dirname, '../profile/ProfileHubScreen.tsx'),
  'utf8',
);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extract the source block for a named Stack.Screen registration.
 * Returns the text from the `name="<screenName>"` marker through the
 * following `</Stack.Screen>` close tag (rough but sufficient for SD-9 guard).
 */
function extractScreenBlock(src: string, screenName: string): string {
  const marker = `name="${screenName}"`;
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) return '';
  const endMarker = '</Stack.Screen>';
  const endIdx = src.indexOf(endMarker, startIdx);
  if (endIdx === -1) return src.slice(startIdx);
  return src.slice(startIdx, endIdx + endMarker.length);
}

// ─── A: Route registered in RootStackParamList (types.ts) ────────────────────

describe('[B1 Reachability] PregnancySummary route in RootStackParamList', () => {
  it('types.ts declares PregnancySummary in RootStackParamList', () => {
    expect(NAV_TYPES_SRC).toContain('PregnancySummary');
  });

  it('PregnancySummary route params are undefined (SD-9: no health data in route params)', () => {
    // Health data (edd, birthDate, deliveryType, hospitalDates) must NOT be in params.
    // The screen obtains its inputs via GET on mount — same pattern as ProfileInfoEdit.
    expect(NAV_TYPES_SRC).toContain('PregnancySummary: undefined');
  });

  it('TypeScript key PregnancySummary exists in RootStackParamList (compile-time proof)', () => {
    // If the key is removed from types.ts this line fails to compile (TS2345).
    type HasKey = 'PregnancySummary' extends keyof RootStackParamList ? true : false;
    const check: HasKey = true;
    expect(check).toBe(true);
  });
});

// ─── B: Screen registered in RootNavigator ────────────────────────────────────

describe('[B1 Reachability] PregnancySummary registered as a Stack.Screen', () => {
  it('RootNavigator.tsx contains PregnancySummary screen name', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('PregnancySummary');
  });

  it('RootNavigator.tsx has a Stack.Screen with name="PregnancySummary"', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('name="PregnancySummary"');
  });

  it('RootNavigator.tsx imports or references PregnancySummaryScreen', () => {
    // The navigator (or a wrapper inside it) must reference the actual screen component.
    expect(ROOT_NAVIGATOR_SRC).toContain('PregnancySummaryScreen');
  });

  it('[SD-9] PregnancySummary registration does NOT pass health data in route params', () => {
    // Screen must get health data via GET on mount — NOT forwarded as route params.
    const block = extractScreenBlock(ROOT_NAVIGATOR_SRC, 'PregnancySummary');
    expect(block).not.toContain('route.params.edd');
    expect(block).not.toContain('route.params.deliveryType');
    expect(block).not.toContain('route.params.hospitalAdmission');
    expect(block).not.toContain('route.params.birthDate');
  });
});

// ─── C: Handler wired in BottomTabNavigator ───────────────────────────────────

describe('[B1 Reachability] onPregnancySummary handler wired in BottomTabNavigator', () => {
  it('BottomTabNavigator.tsx passes onPregnancySummary prop to ProfileHubScreen', () => {
    // Without this prop, ProfileHubScreen hides the pregnancySummaryBtn row.
    expect(BOTTOM_TAB_SRC).toContain('onPregnancySummary');
  });

  it("BottomTabNavigator.tsx wires onPregnancySummary to navigate('PregnancySummary')", () => {
    // The handler must call navigate to the registered route name.
    expect(BOTTOM_TAB_SRC).toContain("navigate('PregnancySummary')");
  });
});

// ─── D: ProfileHubScreen renders the row when handler is provided ─────────────

describe('[B1 Reachability] ProfileHubScreen pregnancySummaryBtn row conditional rendering', () => {
  it('ProfileHubScreen.tsx uses pregnancySummaryBtn testID', () => {
    // The row must carry the testID for automation and test targeting.
    expect(PROFILE_HUB_SRC).toContain('pregnancySummaryBtn');
  });

  it('ProfileHubScreen.tsx accepts and uses onPregnancySummary prop', () => {
    // Row is conditional — only rendered when the handler prop is provided.
    expect(PROFILE_HUB_SRC).toContain('onPregnancySummary');
  });
});
