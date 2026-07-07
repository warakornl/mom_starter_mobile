/**
 * tabNavigatorConfig.iconName.test.ts — TDD tests for the iconName field.
 *
 * Spec: minimal-redesign-clean-spec.md §2 Tell 1 Fix A
 *
 * Validates that:
 *   1. Each tab config has an iconName field (no longer iconGlyph)
 *   2. Each iconName is one of the 6 valid string keys
 *   3. The mapping from tab name to iconName is correct
 *   4. No tab has an iconGlyph field (removed field)
 *
 * Pure-Node invariant preserved: no React or SVG imports in this test.
 */

import { TAB_CONFIGS } from './tabNavigatorConfig';

const VALID_ICON_NAMES = ['supplies', 'expenses', 'home', 'calendar', 'medication', 'profile'] as const;
type ValidIconName = typeof VALID_ICON_NAMES[number];

describe('tabNavigatorConfig — iconName field (Clean redesign Phase 1)', () => {
  it('every tab has an iconName field', () => {
    for (const tab of TAB_CONFIGS) {
      expect(tab).toHaveProperty('iconName');
    }
  });

  it('every iconName is one of the 6 valid string keys', () => {
    for (const tab of TAB_CONFIGS) {
      expect(VALID_ICON_NAMES).toContain(tab.iconName as ValidIconName);
    }
  });

  it('Supplies tab has iconName "supplies"', () => {
    const tab = TAB_CONFIGS.find((c) => c.name === 'Supplies')!;
    expect(tab.iconName).toBe('supplies');
  });

  it('Expenses tab has iconName "expenses"', () => {
    const tab = TAB_CONFIGS.find((c) => c.name === 'Expenses')!;
    expect(tab.iconName).toBe('expenses');
  });

  it('Home tab has iconName "home"', () => {
    const tab = TAB_CONFIGS.find((c) => c.name === 'Home')!;
    expect(tab.iconName).toBe('home');
  });

  it('Calendar tab has iconName "calendar"', () => {
    const tab = TAB_CONFIGS.find((c) => c.name === 'Calendar')!;
    expect(tab.iconName).toBe('calendar');
  });

  it('Medication tab has iconName "medication"', () => {
    const tab = TAB_CONFIGS.find((c) => c.name === 'Medication')!;
    expect(tab.iconName).toBe('medication');
  });

  it('Profile tab has iconName "profile"', () => {
    const tab = TAB_CONFIGS.find((c) => c.name === 'Profile')!;
    expect(tab.iconName).toBe('profile');
  });

  it('no tab has an iconGlyph field (emoji field removed)', () => {
    for (const tab of TAB_CONFIGS) {
      expect(tab).not.toHaveProperty('iconGlyph');
    }
  });
});
