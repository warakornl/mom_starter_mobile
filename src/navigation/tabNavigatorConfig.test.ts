/**
 * tabNavigatorConfig.test.ts — TDD tests for tab navigator pure config.
 *
 * Tests:
 *   - 5 tabs in correct order
 *   - initialRouteName = 'Calendar'
 *   - Calendar is at center index 2
 *   - only Calendar has isCenter = true
 *   - each tab carries required i18n key fields
 *   - Calendar a11y key follows spec §8.2
 */

import { TAB_CONFIGS, INITIAL_TAB, CENTER_TAB_INDEX } from './tabNavigatorConfig';

// ─── Tab count and order ──────────────────────────────────────────────────────

describe('tabNavigatorConfig — tab structure', () => {
  it('defines exactly 5 tabs', () => {
    expect(TAB_CONFIGS).toHaveLength(5);
  });

  it('tab order is Supplies → Expenses → Calendar → Report → Medication', () => {
    const names = TAB_CONFIGS.map((c) => c.name);
    expect(names).toEqual(['Supplies', 'Expenses', 'Calendar', 'Report', 'Medication']);
  });

  it('each tab has a non-empty name, labelKey, and a11yKey', () => {
    for (const tab of TAB_CONFIGS) {
      expect(tab.name).toBeTruthy();
      expect(tab.labelKey).toBeTruthy();
      expect(tab.a11yKey).toBeTruthy();
    }
  });
});

// ─── Initial route ────────────────────────────────────────────────────────────

describe('tabNavigatorConfig — initial route', () => {
  it('INITIAL_TAB is Calendar (center tab, per owner decision)', () => {
    expect(INITIAL_TAB).toBe('Calendar');
  });
});

// ─── Center tab ───────────────────────────────────────────────────────────────

describe('tabNavigatorConfig — center tab', () => {
  it('CENTER_TAB_INDEX is 2 (position 3 of 5, zero-indexed)', () => {
    expect(CENTER_TAB_INDEX).toBe(2);
  });

  it('tab at CENTER_TAB_INDEX is Calendar', () => {
    expect(TAB_CONFIGS[CENTER_TAB_INDEX].name).toBe('Calendar');
  });

  it('only the Calendar tab has isCenter = true', () => {
    const centerTabs = TAB_CONFIGS.filter((c) => c.isCenter);
    expect(centerTabs).toHaveLength(1);
    expect(centerTabs[0].name).toBe('Calendar');
  });

  it('all non-center tabs have isCenter = false', () => {
    const nonCenter = TAB_CONFIGS.filter((c) => !c.isCenter);
    expect(nonCenter).toHaveLength(4);
    for (const tab of nonCenter) {
      expect(tab.isCenter).toBe(false);
    }
  });
});

// ─── A11y key values (spec §8.2) ─────────────────────────────────────────────

describe('tabNavigatorConfig — a11y key references', () => {
  it('Calendar a11y key is tab.calendar.a11y', () => {
    const cal = TAB_CONFIGS.find((c) => c.name === 'Calendar')!;
    expect(cal.a11yKey).toBe('tab.calendar.a11y');
  });

  it('Supplies a11y key is tab.supplies.a11y', () => {
    const s = TAB_CONFIGS.find((c) => c.name === 'Supplies')!;
    expect(s.a11yKey).toBe('tab.supplies.a11y');
  });

  it('Medication a11y key is tab.medication.a11y', () => {
    const m = TAB_CONFIGS.find((c) => c.name === 'Medication')!;
    expect(m.a11yKey).toBe('tab.medication.a11y');
  });
});

// ─── Label key references ─────────────────────────────────────────────────────

describe('tabNavigatorConfig — label key references', () => {
  it('Calendar label key is tab.calendar', () => {
    const cal = TAB_CONFIGS.find((c) => c.name === 'Calendar')!;
    expect(cal.labelKey).toBe('tab.calendar');
  });

  it('Supplies label key is tab.supplies', () => {
    const s = TAB_CONFIGS.find((c) => c.name === 'Supplies')!;
    expect(s.labelKey).toBe('tab.supplies');
  });
});
