/**
 * tabNavigatorConfig.ts — pure tab navigator configuration data.
 *
 * Defines the 5-tab IA per bottom-tab-navigation-design.md v2.1 §1.1 and §8.2.
 * This file contains no React or navigation imports so it can be unit-tested
 * in a pure Node environment.
 *
 * v2 Owner decisions baked in (§10 resolved decisions):
 *   - OQ-NAV-1: initialRouteName = 'Home' (was 'Calendar'; dashboard moved to Home)
 *   - OQ-NAV-3: Active highlight = moving disc across ALL 5 tabs (isFocused, not isCenter)
 *   - OQ-NAV-4: Doctor Report removed from tab bar; accessed from Home tab row → root stack
 *   - OQ-NAV-5: Supplies label = 'ของใช้' (was 'เตรียม'; lifecycle-neutral)
 *
 * Tab order (v2):
 *   1 Supplies  2 Expenses  3 Home (center)  4 Calendar  5 Medication
 *
 * Icon strategy: icon glyph strings are Unicode emoji/characters used as
 * placeholders because the project does not yet have a vector icon library.
 * They match the required silhouettes per design-system.md §4.
 */

import type { MessageKey } from '../i18n/messages';

// ─── Tab config shape ─────────────────────────────────────────────────────────

export interface TabConfig {
  /** React Navigation route name (matches TabParamList). */
  name: 'Supplies' | 'Expenses' | 'Home' | 'Calendar' | 'Medication';
  /** i18n key for the visible tab label (short form). */
  labelKey: MessageKey;
  /** i18n key for the screen-reader accessibility label (full form, spec §8.2). */
  a11yKey: MessageKey;
  /** Icon glyph / placeholder text (24dp rendered via Text). */
  iconGlyph: string;
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
 * Ordered list of 5 tab configurations (v2).
 * Order: Supplies (1) · Expenses (2) · Home (3, center) · Calendar (4) · Medication (5).
 *
 * §8.1: Screen reader order follows left-to-right visual order 1→5.
 */
export const TAB_CONFIGS: TabConfig[] = [
  {
    name: 'Supplies',
    labelKey: 'tab.supplies',
    a11yKey: 'tab.supplies.a11y',
    iconGlyph: '✓',
    isCenter: false,
  },
  {
    name: 'Expenses',
    labelKey: 'tab.expenses',
    a11yKey: 'tab.expenses.a11y',
    iconGlyph: '฿',
    isCenter: false,
  },
  {
    name: 'Home',
    labelKey: 'tab.home',
    a11yKey: 'tab.home.a11y',
    iconGlyph: '🏠',
    isCenter: true,
  },
  {
    name: 'Calendar',
    labelKey: 'tab.calendar',
    a11yKey: 'tab.calendar.a11y',
    iconGlyph: '📅',
    isCenter: false,
  },
  {
    name: 'Medication',
    labelKey: 'tab.medication',
    a11yKey: 'tab.medication.a11y',
    iconGlyph: '💊',
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
