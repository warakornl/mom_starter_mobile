/**
 * tabBarMotherRoom.test.ts — TDD for tab bar Mother's Room redesign (§3.4 + §4.1)
 *
 * Spec: docs/design/mother-room-build-spec.md §3.4 (tab bar) + §4.1 (layout)
 *
 * Changes (Mother's Room v3):
 *   - Moving disc (rose/600) REPLACED by 2dp amber-700 underline below icon (§3.4)
 *   - Background: #FFFFFF → ivory-100 #FBF6F1 (matches screen background)
 *   - Top border: #EBE1D9 → #E8DDD5 (new divider)
 *   - Active icon: #FFFFFF (on disc) → roselle-900 #4A2230 (no disc)
 *   - Active label: rose/700 #8E3A44 → roselle-900 #4A2230
 *   - Inactive: ink/soft #5F4A52 → roselle-700 #7A3A52
 *   - Focus ring: honey/700 #B96A28 → amber-600 #B8720E (tokens.focus.ring.color)
 *   - Label font: IBMPlexSans-SemiBold → Sarabun-SemiBold
 *
 * Tests verify token values in TAB_BAR_TOKENS after update.
 * Pure-Node environment — no react-native imports needed.
 */

import { TAB_BAR_TOKENS } from './tabNavigatorConfig';
import { T } from '../theme/tokens';

// ─── 1. Background + border (§4.1 tab bar ivory background) ──────────────────

describe('Tab bar — background + border tokens (Mother\'s Room §3.4)', () => {
  it('TAB_BAR_TOKENS.background is ivory-100 #FBF6F1 (matches screen bg; §4.1)', () => {
    // §4.1: "Tab bar [bg: #FBF6F1, 1px #E8DDD5 top]"
    expect(TAB_BAR_TOKENS.background).toBe('#FBF6F1');
  });

  it('TAB_BAR_TOKENS.borderColor is #E8DDD5 (new divider, not #EBE1D9; §3.4)', () => {
    expect(TAB_BAR_TOKENS.borderColor).toBe('#E8DDD5');
  });

  it('token alignment: TAB_BAR_TOKENS.background matches T.color.surface.base', () => {
    expect(TAB_BAR_TOKENS.background).toBe(T.color.surface.base);
  });

  it('token alignment: TAB_BAR_TOKENS.borderColor matches T.color.surface.divider', () => {
    expect(TAB_BAR_TOKENS.borderColor).toBe(T.color.surface.divider);
  });
});

// ─── 2. Active underline (§3.4 replaces disc) ────────────────────────────────

describe('Tab bar — active underline (§3.4 replaces moving disc)', () => {
  it('TAB_BAR_TOKENS.activeUnderlineColor is amber-700 #9A5F0A (§3.4)', () => {
    // §3.4: "2dp amber-700 underline below icon" (replaces rose/600 disc)
    expect(TAB_BAR_TOKENS.activeUnderlineColor).toBe('#9A5F0A');
  });

  it('TAB_BAR_TOKENS.activeUnderlineHeight is 2 (2dp; §3.4)', () => {
    expect(TAB_BAR_TOKENS.activeUnderlineHeight).toBe(2);
  });

  it('token alignment: activeUnderlineColor matches T.tab.active.underline.color', () => {
    expect(TAB_BAR_TOKENS.activeUnderlineColor).toBe(T.tab.active.underline.color);
  });

  it('token alignment: activeUnderlineHeight matches T.tab.active.underline.height', () => {
    expect(TAB_BAR_TOKENS.activeUnderlineHeight).toBe(T.tab.active.underline.height);
  });
});

// ─── 3. Active icon + label colors (§3.4 roselle-900 without disc) ───────────

describe('Tab bar — active icon + label colors (§3.4)', () => {
  it('TAB_BAR_TOKENS.activeIconColor is roselle-900 #4A2230 (no disc; §3.4)', () => {
    // When active but NO disc: icon uses roselle-900 directly (dark, high contrast)
    expect(TAB_BAR_TOKENS.activeIconColor).toBe('#4A2230');
  });

  it('TAB_BAR_TOKENS.activeLabelColor is roselle-900 #4A2230 (§3.4)', () => {
    expect(TAB_BAR_TOKENS.activeLabelColor).toBe('#4A2230');
  });

  it('token alignment: activeIconColor matches T.tab.active.icon.color', () => {
    expect(TAB_BAR_TOKENS.activeIconColor).toBe(T.tab.active.icon.color);
  });

  it('token alignment: activeLabelColor matches T.tab.active.label.color', () => {
    expect(TAB_BAR_TOKENS.activeLabelColor).toBe(T.tab.active.label.color);
  });
});

// ─── 4. Inactive colors (§3.4 roselle-700) ───────────────────────────────────

describe('Tab bar — inactive colors (§3.4)', () => {
  it('TAB_BAR_TOKENS.inactiveColor is roselle-700 #7A3A52 (§3.4)', () => {
    // §3.4: inactive tabs = roselle-700 (was ink/soft #5F4A52)
    expect(TAB_BAR_TOKENS.inactiveColor).toBe('#7A3A52');
  });

  it('token alignment: inactiveColor matches T.tab.inactive.icon.color', () => {
    expect(TAB_BAR_TOKENS.inactiveColor).toBe(T.tab.inactive.icon.color);
  });
});

// ─── 5. Focus ring (§3.4 / §8.5) ─────────────────────────────────────────────

describe('Tab bar — focus ring color (§8.5 keyboard/switch-control)', () => {
  it('TAB_BAR_TOKENS.focusRingColor is amber-600 #B8720E (§8.5; was honey/700)', () => {
    // §8.5: focus ring = amber-600 #B8720E (matches T.focus.ring.color)
    expect(TAB_BAR_TOKENS.focusRingColor).toBe('#B8720E');
  });

  it('token alignment: focusRingColor matches T.focus.ring.color', () => {
    expect(TAB_BAR_TOKENS.focusRingColor).toBe(T.focus.ring.color);
  });
});

// ─── 6. No disc tokens (§3.4: disc removed) ──────────────────────────────────

describe('Tab bar — disc tokens removed (§3.4 underline replaces disc)', () => {
  it('TAB_BAR_TOKENS has no activeDiscColor property (disc removed in Mother\'s Room)', () => {
    // §3.4: "replace disc active indicator with amber-700 2dp underline"
    expect('activeDiscColor' in TAB_BAR_TOKENS).toBe(false);
  });

  it('TAB_BAR_TOKENS has no activeDiscSize property (disc removed)', () => {
    expect('activeDiscSize' in TAB_BAR_TOKENS).toBe(false);
  });

  it('TAB_BAR_TOKENS has no activeDiscRadius property (disc removed)', () => {
    expect('activeDiscRadius' in TAB_BAR_TOKENS).toBe(false);
  });
});
