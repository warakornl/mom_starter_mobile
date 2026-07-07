/**
 * tabNavigatorConfig.ts — pure tab navigator configuration data.
 *
 * Defines the 6-tab IA per:
 *   - bottom-tab-navigation-design.md v2.1 §1.1 and §8.2 (5-tab baseline)
 *   - profile-tab-and-hub-ui.md v1.1 §1.1, §6.1, §7.1 (6th tab addition)
 *
 * This file contains no React or navigation imports so it can be unit-tested
 * in a pure Node environment.
 *
 * v2 Owner decisions:
 *   - OQ-NAV-1: initialRouteName = 'Home' (was 'Calendar'; dashboard moved to Home)
 *   - OQ-NAV-3: Active highlight = moving disc across ALL tabs (isFocused, not isCenter)
 *   - OQ-NAV-4: Doctor Report removed from tab bar; accessed from Home tab row → root stack
 *   - OQ-NAV-5: Supplies label = 'ของใช้' (was 'เตรียม'; lifecycle-neutral)
 *
 * v3 changes (profile-tab-and-hub-ui.md v1.1):
 *   - 6th tab: Profile (far right, after Medication) — icon/person-outline placeholder
 *   - Home isCenter: false (was true at index 2 of 5; now left-of-center at index 2 of 6)
 *   - TabConfig.name union extended with 'Profile'
 *   - Label fit decision: 13pt retained — "โปรไฟล์" fits in 65dp column without clipping;
 *     "ค่าใช้จ่าย" wraps to 2 lines (existing behavior with numberOfLines={2}).
 *
 * Tab order (v3):
 *   1 Supplies  2 Expenses  3 Home  4 Calendar  5 Medication  6 Profile
 *
 * Icon strategy: stable string key `iconName` maps to SVG components in
 * CustomTabBar (BottomTabNavigator.tsx). This file stays pure-Node — no React
 * or SVG imports — so unit tests run without a DOM. The iconName→component
 * mapping (ICON_MAP) lives in the view layer only.
 * Spec: minimal-redesign-clean-spec.md §2 Tell 1 Fix A
 */

import type { MessageKey } from '../i18n/messages';

// ─── Tab config shape ─────────────────────────────────────────────────────────

export interface TabConfig {
  /** React Navigation route name (matches TabParamList). */
  name: 'Supplies' | 'Expenses' | 'Home' | 'Calendar' | 'Medication' | 'Profile';
  /** i18n key for the visible tab label (short form). */
  labelKey: MessageKey;
  /** i18n key for the screen-reader accessibility label (full form, spec §8.2). */
  a11yKey: MessageKey;
  /**
   * Icon name key — maps to an SVG component in CustomTabBar's ICON_MAP.
   * Pure string union keeps this file free of React/SVG imports (pure-Node invariant).
   * View layer (BottomTabNavigator.tsx) owns the iconName→component mapping.
   * Spec: minimal-redesign-clean-spec.md §2 Tell 1 Fix A
   */
  iconName: 'supplies' | 'expenses' | 'home' | 'calendar' | 'medication' | 'profile';
  /**
   * True for the center Home tab — marks positional identity in the tab bar.
   * NOTE v2: `isCenter` is now a spatial/identity marker only. The active disc
   * in CustomTabBar is driven by `isFocused` for ALL 5 tabs (moving disc per
   * OQ-NAV-3). `isCenter` is no longer used for permanent disc rendering.
   */
  isCenter: boolean;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

/**
 * Ordered list of 6 tab configurations (v3).
 * Order: Supplies (1) · Expenses (2) · Home (3) · Calendar (4) · Medication (5) · Profile (6).
 *
 * §8.1: Screen reader order follows left-to-right visual order 1→6.
 */
export const TAB_CONFIGS: TabConfig[] = [
  {
    name: 'Supplies',
    labelKey: 'tab.supplies',
    a11yKey: 'tab.supplies.a11y',
    iconName: 'supplies',
    isCenter: false,
  },
  {
    name: 'Expenses',
    labelKey: 'tab.expenses',
    a11yKey: 'tab.expenses.a11y',
    iconName: 'expenses',
    isCenter: false,
  },
  {
    name: 'Home',
    labelKey: 'tab.home',
    a11yKey: 'tab.home.a11y',
    iconName: 'home',
    // was center at index 2 of 5; now left-of-center at index 2 of 6
    isCenter: false,
  },
  {
    name: 'Calendar',
    labelKey: 'tab.calendar',
    a11yKey: 'tab.calendar.a11y',
    iconName: 'calendar',
    isCenter: false,
  },
  {
    name: 'Medication',
    labelKey: 'tab.medication',
    a11yKey: 'tab.medication.a11y',
    iconName: 'medication',
    isCenter: false,
  },
  {
    // v3: 6th tab — Profile Hub (profile-tab-and-hub-ui.md §6.1, §2.4)
    name: 'Profile',
    labelKey: 'tab.profile',
    a11yKey: 'tab.profile.a11y',
    iconName: 'profile',
    isCenter: false,
  },
];

/**
 * initialRouteName for the bottom tab navigator (v2 owner decision §10 OQ-NAV-1).
 * Changed from 'Calendar' to 'Home' — dashboard + snapshot population now on Home.
 */
export const INITIAL_TAB: 'Home' = 'Home';

/** Zero-indexed position of the center tab (Home = index 2 of 5). */
export const CENTER_TAB_INDEX = 2;

// ─── Design tokens (tab bar visual spec v2 §2.1, §7.5) ───────────────────────

export const TAB_BAR_TOKENS = {
  /** Tab bar container background (surface/page). */
  background: '#FFFFFF',
  /** Top border hairline color. */
  borderColor: '#EBE1D9',
  /** Tab bar content height in dp (above safe-area inset). */
  contentHeight: 56,
  /**
   * Active disc: rose/600 fill — shown on FOCUSED tab (any of 5 tabs, v2 §2.1).
   * Renamed from centerDiscColor to reflect moving-disc behavior.
   */
  activeDiscColor: '#A8505A',
  /** Active disc: icon color (white on rose/600 background). */
  activeIconColor: '#FFFFFF',
  /** Active disc size in dp (52×52dp per spec §2.1). */
  activeDiscSize: 52,
  /** Active disc border radius (pill = 999). */
  activeDiscRadius: 999,
  /** Active tab label color (rose/700). */
  activeLabelColor: '#8E3A44', // rose/700
  /** Inactive tab icon + label color (ink/soft — meets 4.5:1 AA contrast). */
  inactiveColor: '#5F4A52',
  /** Focus ring color (honey/700, keyboard / switch-control §8.5). */
  focusRingColor: '#B96A28',
} as const;
