/**
 * tabNavigatorConfig.test.ts — TDD tests for tab navigator pure config.
 *
 * v2 update (bottom-tab-navigation-design.md v2.1):
 *   Tab order: Supplies → Expenses → Home (center) → Calendar → Medication
 *   initialRouteName = 'Home' (was 'Calendar', OQ-NAV-1 owner re-decision)
 *   Center tab is 'Home' (house icon, always visible home dashboard)
 *   'Report' tab removed — Doctor Report accessed via Home tab row → root-stack screen
 *   Active disc: isFocused on ALL 5 tabs (was permanent-center-only in v1)
 *
 * Tests:
 *   - 5 tabs in correct v2 order
 *   - initialRouteName = 'Home'
 *   - Home is at center index 2
 *   - only Home has isCenter = true
 *   - each tab carries required i18n key fields
 *   - Home a11y key follows spec §8.2
 *   - Calendar a11y key follows spec §8.2 (simplified — Calendar tab now grid-only)
 *   - Supplies label key = tab.supplies (updated to ของใช้ in v2 per OQ-NAV-5)
 */

import { TAB_CONFIGS, INITIAL_TAB, CENTER_TAB_INDEX } from './tabNavigatorConfig';

// ─── Tab count and order ──────────────────────────────────────────────────────

describe('tabNavigatorConfig — tab structure (v2)', () => {
  it('defines exactly 5 tabs', () => {
    expect(TAB_CONFIGS).toHaveLength(5);
  });

  it('tab order is Supplies → Expenses → Home → Calendar → Medication (v2 §1.1)', () => {
    const names = TAB_CONFIGS.map((c) => c.name);
    expect(names).toEqual(['Supplies', 'Expenses', 'Home', 'Calendar', 'Medication']);
  });

  it('does NOT include a Report tab (Doctor Report removed from tab bar in v2)', () => {
    const names = TAB_CONFIGS.map((c) => c.name);
    expect(names).not.toContain('Report');
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

describe('tabNavigatorConfig — initial route (v2)', () => {
  it('INITIAL_TAB is Home (owner decision v2: initialRouteName = "Home" §1.1)', () => {
    expect(INITIAL_TAB).toBe('Home');
  });
});

// ─── Center tab ───────────────────────────────────────────────────────────────

describe('tabNavigatorConfig — center tab (v2)', () => {
  it('CENTER_TAB_INDEX is 2 (position 3 of 5, zero-indexed — same position, now Home)', () => {
    expect(CENTER_TAB_INDEX).toBe(2);
  });

  it('tab at CENTER_TAB_INDEX is Home (v2: center = home/dashboard)', () => {
    expect(TAB_CONFIGS[CENTER_TAB_INDEX].name).toBe('Home');
  });

  it('only the Home tab has isCenter = true (v2: center = Home)', () => {
    const centerTabs = TAB_CONFIGS.filter((c) => c.isCenter);
    expect(centerTabs).toHaveLength(1);
    expect(centerTabs[0].name).toBe('Home');
  });

  it('all non-Home tabs have isCenter = false', () => {
    const nonCenter = TAB_CONFIGS.filter((c) => !c.isCenter);
    expect(nonCenter).toHaveLength(4);
    for (const tab of nonCenter) {
      expect(tab.isCenter).toBe(false);
    }
  });
});

// ─── A11y key values (spec §8.2) ─────────────────────────────────────────────

describe('tabNavigatorConfig — a11y key references (v2 §8.2)', () => {
  it('Home a11y key is tab.home.a11y (center tab, v2 §8.2)', () => {
    const home = TAB_CONFIGS.find((c) => c.name === 'Home')!;
    expect(home.a11yKey).toBe('tab.home.a11y');
  });

  it('Calendar a11y key is tab.calendar.a11y (v2: calendar is now grid-only tab)', () => {
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

describe('tabNavigatorConfig — label key references (v2)', () => {
  it('Home label key is tab.home (v2 center tab)', () => {
    const home = TAB_CONFIGS.find((c) => c.name === 'Home')!;
    expect(home.labelKey).toBe('tab.home');
  });

  it('Calendar label key is tab.calendar (v2 calendar tab — grid only)', () => {
    const cal = TAB_CONFIGS.find((c) => c.name === 'Calendar')!;
    expect(cal.labelKey).toBe('tab.calendar');
  });

  it('Supplies label key is tab.supplies (v2: label changed to ของใช้ per OQ-NAV-5)', () => {
    const s = TAB_CONFIGS.find((c) => c.name === 'Supplies')!;
    expect(s.labelKey).toBe('tab.supplies');
  });
});
