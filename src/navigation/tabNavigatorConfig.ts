/**
 * tabNavigatorConfig.ts — pure tab navigator configuration data.
 *
 * Defines the 5-tab IA per bottom-tab-navigation-design.md §1.1 and §8.2.
 * This file contains no React or navigation imports so it can be unit-tested
 * in a pure Node environment.
 *
 * Owner decisions baked in (§10):
 *   - OQ-NAV-1: initialRouteName = 'Calendar'
 *   - OQ-NAV-2: Supplies label = 'เตรียม' (short, lifecycle-neutral)
 *
 * Icon strategy: icon glyph strings are Unicode emoji/characters used as
 * placeholders because the project does not yet have a vector icon library.
 * They match the required silhouettes per design-system.md §4.
 */

import type { MessageKey } from '../i18n/messages';

// ─── Tab config shape ─────────────────────────────────────────────────────────

export interface TabConfig {
  /** React Navigation route name (matches RootStackParamList / TabParamList). */
  name: 'Supplies' | 'Expenses' | 'Calendar' | 'Report' | 'Medication';
  /** i18n key for the visible tab label (short form). */
  labelKey: MessageKey;
  /** i18n key for the screen-reader accessibility label (full form, spec §8.2). */
  a11yKey: MessageKey;
  /** Icon glyph / placeholder text (24dp rendered via Text). */
  iconGlyph: string;
  /** True for the center Calendar tab — renders the 52×52dp rose/600 disc. */
  isCenter: boolean;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

/**
 * Ordered list of 5 tab configurations.
 * Order: Supplies (1) · Expenses (2) · Calendar (3, center) · Report (4) · Medication (5).
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
    name: 'Calendar',
    labelKey: 'tab.calendar',
    a11yKey: 'tab.calendar.a11y',
    iconGlyph: '📅',
    isCenter: true,
  },
  {
    name: 'Report',
    labelKey: 'tab.report',
    a11yKey: 'tab.report.a11y',
    iconGlyph: '📄',
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

/** initialRouteName for the bottom tab navigator (owner decision §10 OQ-NAV-1). */
export const INITIAL_TAB: 'Calendar' = 'Calendar';

/** Zero-indexed position of the center tab (Calendar = index 2 of 5). */
export const CENTER_TAB_INDEX = 2;

// ─── Design tokens (tab bar visual spec §2.1, §7.4) ──────────────────────────

export const TAB_BAR_TOKENS = {
  /** Tab bar container background (surface/page). */
  background: '#FFFFFF',
  /** Top border hairline color. */
  borderColor: '#EBE1D9',
  /** Tab bar content height in dp (above safe-area inset). */
  contentHeight: 56,
  /** Center disc: rose/600 fill. */
  centerDiscColor: '#A8505A',
  /** Center disc: icon color (white). */
  centerIconColor: '#FFFFFF',
  /** Center disc size in dp. */
  centerDiscSize: 52,
  /** Center disc border radius (pill = 999). */
  centerDiscRadius: 999,
  /** Active tab icon + label color (non-center active). */
  activeColor: '#A8505A', // rose/600
  /** Active tab label color. */
  activeLabelColor: '#8E3A44', // rose/700
  /** Inactive tab icon + label color (ink/soft — meets 4.5:1 AA contrast). */
  inactiveColor: '#5F4A52',
  /** Focus ring color (honey/700, keyboard / switch-control §8.5). */
  focusRingColor: '#B96A28',
} as const;
