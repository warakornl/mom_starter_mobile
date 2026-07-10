/**
 * autoDecrementReachability.test.ts — Navigation reachability guard for Screen 1+2.
 *
 * Verifies the full chain is wired and no dead features:
 *
 *   SuppliesScreen (supplies-auto-decrement-settings button)
 *     → BottomTabNavigator (navigate('AutoDecrementSettings'))
 *     → RootNavigator (Stack.Screen name="AutoDecrementSettings")
 *     → AutoDecrementSettingsScreen (onNavigateSubUnitSetup prop)
 *     → RootNavigator (Stack.Screen name="SubUnitSetup", route.params.supplyItemId)
 *     → SubUnitSetupScreen (SD-9: supplyItemId only)
 *
 * Pattern: pure-node source inspection (no RNTL) — same as
 * pregnancySummaryReachability.test.ts and doctorReportRouteOptions.test.ts.
 *
 * SD-9 guards:
 *   - AutoDecrementSettings params = undefined (no health data)
 *   - SubUnitSetup params = { supplyItemId: string } ONLY (UUID only)
 *   - SubUnitSetup registration must NOT forward item name/qty/health values as params
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RootStackParamList } from './types';

// ─── Source files ─────────────────────────────────────────────────────────────

const TYPES_SRC = fs.readFileSync(path.join(__dirname, 'types.ts'), 'utf8');

const ROOT_NAVIGATOR_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

const BOTTOM_TAB_SRC = fs.readFileSync(
  path.join(__dirname, 'BottomTabNavigator.tsx'),
  'utf8',
);

const SUPPLIES_SCREEN_SRC = fs.readFileSync(
  path.join(__dirname, '../supplies/SuppliesScreen.tsx'),
  'utf8',
);

const AUTO_DECREMENT_SETTINGS_SRC = fs.readFileSync(
  path.join(__dirname, '../autoStockDecrement/AutoDecrementSettingsScreen.tsx'),
  'utf8',
);

// ─── A: Routes registered in RootStackParamList (types.ts) ───────────────────

describe('[ASD Reachability] AutoDecrementSettings route in RootStackParamList', () => {
  it('types.ts declares AutoDecrementSettings', () => {
    expect(TYPES_SRC).toContain('AutoDecrementSettings');
  });

  it('AutoDecrementSettings route params are undefined (SD-9: no health data)', () => {
    expect(TYPES_SRC).toContain('AutoDecrementSettings: undefined');
  });

  it('TypeScript key AutoDecrementSettings exists in RootStackParamList (compile-time proof)', () => {
    type HasKey = 'AutoDecrementSettings' extends keyof RootStackParamList ? true : false;
    const check: HasKey = true;
    expect(check).toBe(true);
  });
});

describe('[ASD Reachability] SubUnitSetup route in RootStackParamList', () => {
  it('types.ts declares SubUnitSetup', () => {
    expect(TYPES_SRC).toContain('SubUnitSetup');
  });

  it('SubUnitSetup route params contain supplyItemId: string (SD-9: UUID only)', () => {
    expect(TYPES_SRC).toContain('supplyItemId: string');
  });

  it('TypeScript key SubUnitSetup exists in RootStackParamList (compile-time proof)', () => {
    type HasKey = 'SubUnitSetup' extends keyof RootStackParamList ? true : false;
    const check: HasKey = true;
    expect(check).toBe(true);
  });
});

// ─── B: Screens registered in RootNavigator ───────────────────────────────────

describe('[ASD Reachability] AutoDecrementSettings registered in RootNavigator', () => {
  it('RootNavigator.tsx contains AutoDecrementSettings screen name', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('name="AutoDecrementSettings"');
  });

  it('RootNavigator.tsx imports AutoDecrementSettingsScreen', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('AutoDecrementSettingsScreen');
  });

  it('[SD-9] AutoDecrementSettings registration passes NO health data as params', () => {
    // AutoDecrementSettings has no route params — health data read from local store
    const idx = ROOT_NAVIGATOR_SRC.indexOf('"AutoDecrementSettings"');
    const block = ROOT_NAVIGATOR_SRC.slice(idx, ROOT_NAVIGATOR_SRC.indexOf('</Stack.Screen>', idx));
    expect(block).not.toContain('route.params');
  });

  it('AutoDecrementSettings wires onNavigateSubUnitSetup to navigate SubUnitSetup', () => {
    // The onNavigateSubUnitSetup callback must navigate to SubUnitSetup with supplyItemId
    const idx = ROOT_NAVIGATOR_SRC.indexOf('"AutoDecrementSettings"');
    const block = ROOT_NAVIGATOR_SRC.slice(idx, ROOT_NAVIGATOR_SRC.indexOf('</Stack.Screen>', idx));
    expect(block).toContain('SubUnitSetup');
    expect(block).toContain('supplyItemId');
  });
});

describe('[ASD Reachability] SubUnitSetup registered in RootNavigator', () => {
  it('RootNavigator.tsx contains SubUnitSetup screen name', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('name="SubUnitSetup"');
  });

  it('RootNavigator.tsx imports SubUnitSetupScreen', () => {
    expect(ROOT_NAVIGATOR_SRC).toContain('SubUnitSetupScreen');
  });

  it('[SD-9] SubUnitSetup registration passes ONLY supplyItemId from route params', () => {
    const idx = ROOT_NAVIGATOR_SRC.indexOf('"SubUnitSetup"');
    const block = ROOT_NAVIGATOR_SRC.slice(idx, ROOT_NAVIGATOR_SRC.indexOf('</Stack.Screen>', idx));
    // Must pass supplyItemId
    expect(block).toContain('route.params.supplyItemId');
    // Must NOT pass health-adjacent fields
    expect(block).not.toContain('route.params.name');
    expect(block).not.toContain('route.params.onHandQty');
    expect(block).not.toContain('route.params.usesPerContainer');
  });
});

// ─── C: Entry control wired in BottomTabNavigator ────────────────────────────

describe('[ASD Reachability] onAutoDecrementSettings wired in BottomTabNavigator', () => {
  it('BottomTabNavigator.tsx passes onAutoDecrementSettings to SuppliesScreen', () => {
    expect(BOTTOM_TAB_SRC).toContain('onAutoDecrementSettings');
  });

  it("BottomTabNavigator.tsx wires onAutoDecrementSettings to navigate('AutoDecrementSettings')", () => {
    expect(BOTTOM_TAB_SRC).toContain("navigate('AutoDecrementSettings')");
  });
});

// ─── D: SuppliesScreen has the entry button ───────────────────────────────────

describe('[ASD Reachability] SuppliesScreen entry button', () => {
  it('SuppliesScreen.tsx accepts onAutoDecrementSettings prop', () => {
    expect(SUPPLIES_SCREEN_SRC).toContain('onAutoDecrementSettings');
  });

  it('SuppliesScreen.tsx has supplies-auto-decrement-settings testID', () => {
    expect(SUPPLIES_SCREEN_SRC).toContain('supplies-auto-decrement-settings');
  });
});

// ─── E: AutoDecrementSettingsScreen accepts onNavigateSubUnitSetup prop ───────

describe('[ASD Reachability] AutoDecrementSettingsScreen deep-link to SubUnitSetup', () => {
  it('AutoDecrementSettingsScreen.tsx accepts onNavigateSubUnitSetup prop', () => {
    expect(AUTO_DECREMENT_SETTINGS_SRC).toContain('onNavigateSubUnitSetup');
  });

  it('[SD-9] onNavigateSubUnitSetup passes supplyItemId only (no health data)', () => {
    // The callback type must accept only an ID string — confirmed by TypeScript
    // and by source-inspecting that no health field names appear in the prop name
    expect(AUTO_DECREMENT_SETTINGS_SRC).toContain('onNavigateSubUnitSetup?: (supplyItemId: string)');
  });
});
