/**
 * babySizeSection.disclaimerModal.test.ts
 *
 * TDD reproduction test for the BabySizeSection "ดูเพิ่มเติม" modal bug.
 *
 * ROOT CAUSE: The disclaimer link <TouchableOpacity> is nested inside
 * <View accessibilityRole="text" accessibilityLabel={a11yLabel}>.
 * On iOS, accessibilityRole="text" + accessibilityLabel makes the container
 * isAccessibilityElement=YES.  VoiceOver/TalkBack then treat the entire section
 * as one non-interactive text element — the inner button is unreachable for any
 * user navigating with assistive technology.  The modal never opens.
 *
 * FIX: Move accessibilityRole="text"/accessibilityLabel to the content-row View
 * (the icon + size info), and make the disclaimer link a SIBLING of that view,
 * not a child.  Both pregnant and postpartum variants must be fixed.
 *
 * Test environment: node (no RNTL).
 * Strategy: mock all external deps so BabySizeSection can be called as a plain
 * function; traverse the returned React element tree to assert structure.
 *
 * RED→GREEN tests: [RED→GREEN] prefix — fail before the fix, pass after.
 * GUARD tests: verify the onPress wiring is correct (pass before AND after fix).
 */

// ─── Capture the state setter exposed by our useState mock ───────────────────
// Written every time BabySizeSection calls useState(false) so we can simulate
// pressing the link and asserting setModalVisible(true) was called.

let capturedSetModalVisible: jest.Mock = jest.fn();

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

jest.mock('react', () => {
  // Keep all of real React; only replace useState to allow calling the component
  // outside React's render pipeline (avoids "Invalid hook call" error).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const actual = jest.requireActual<object>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      // Capture the setter so tests can verify the onPress handler calls it.
      capturedSetModalVisible = jest.fn();
      return [initial, capturedSetModalVisible];
    },
  };
});

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: (o: unknown) => o },
}));

jest.mock('../icons', () => ({
  BabySizeSmallRoundIcon:    () => null,
  BabySizeStrawberryIcon:    () => null,
  BabySizeAppleIcon:         () => null,
  BabySizeAvocadoIcon:       () => null,
  BabySizePearIcon:          () => null,
  BabySizeMangoIcon:         () => null,
  BabySizeBananaIcon:        () => null,
  BabySizeCarrotIcon:        () => null,
  BabySizePapayaIcon:        () => null,
  BabySizeCornIcon:          () => null,
  BabySizePineappleIcon:     () => null,
  BabySizeEggplantIcon:      () => null,
  BabySizeSquashIcon:        () => null,
  BabySizeLargeRibbedRoundIcon: () => null,
  BabySizeWatermelonIcon:    () => null,
  BabyFootprintIcon:         () => null,
  CloseIcon:                 () => null,
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

jest.mock('../i18n/messages', () => ({
  interpolate: (tpl: string) => tpl,
}));

jest.mock('../pregnancy/babySizeData', () => ({
  getBabySizeEntry: (week: number | null | undefined) =>
    week != null && week >= 5
      ? {
          week,
          iconKey: 'apple' as const,
          nameTh: 'แอปเปิ้ล',
          nameEn: 'Apple',
          lengthCm: 25,
          weightG: 300,
          weightIsKg: false,
        }
      : null,
  formatWeightDisplay: () => '300 g',
  BABY_SIZE_DATA: [],
}));

jest.mock('./babySizeSectionHelpers', () => ({
  formatPostpartumAgeForSection: () => 'ลูกน้อยอายุ 1 เดือน',
}));

// ─── Imports (after mock setup) ───────────────────────────────────────────────

import React from 'react';
import { BabySizeSection } from './BabySizeSection';
import type { GestationalAge } from '../pregnancy/gestationalAge';
import type { PostpartumAge } from '../pregnancy/postpartumAge';

// ─── Helper: depth-first search over a React element tree ────────────────────

/**
 * findFirst — returns the first React element in the tree that matches predicate,
 * or null if none found.  Handles Fragments, arrays, and single-element children.
 * Does NOT recurse into function-component elements (it only calls the predicate
 * on elements as-returned by the component function, not on their render output).
 */
function findFirst(
  node: unknown,
  predicate: (el: React.ReactElement) => boolean,
): React.ReactElement | null {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    for (const child of node as unknown[]) {
      const found = findFirst(child, predicate);
      if (found !== null) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement;
  if (predicate(el)) return el;
  const { children } = el.props as { children?: unknown };
  return findFirst(children, predicate);
}

// ─── Test data ────────────────────────────────────────────────────────────────

const pregnantGa: GestationalAge = {
  daysPregnant: 140,
  gestationalWeek: 20,
  gestationalDay: 0,
  daysRemaining: 140,
  progress: 0.5,
  currentStage: 'T2',
  deliveryWindowActive: false,
  displayedWeek: 20,
  suppressDayDisplay: false,
};

const postpartumPp: PostpartumAge = {
  postpartumDays: 30,
  postpartumWeek: 4,
  postpartumDay: 2,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BabySizeSection — disclaimer-modal accessibility wiring (REPRO + GUARD)', () => {

  // ── ROOT CAUSE repro (RED before fix, GREEN after) ────────────────────────

  describe('[RED→GREEN] disclaimer link must NOT be inside accessibilityRole="text" container', () => {
    /**
     * WHY this test proves the bug:
     *   The outer <View accessibilityRole="text" accessibilityLabel={...}> makes the
     *   section isAccessibilityElement=YES on iOS.  Any TouchableOpacity nested inside
     *   is swallowed into the parent's accessibility element and is unreachable by
     *   VoiceOver — pressing it does nothing.
     *
     * BEFORE FIX: The disclaimer link IS inside the outer View → expect().toBeNull() FAILS.
     * AFTER FIX:  The accessible label moves to the content-row View only; the link is a
     *             sibling → no TouchableOpacity inside the accessible View → PASSES.
     */
    it('pregnant variant: disclaimer TouchableOpacity is NOT inside a View with accessibilityRole="text"', () => {
      const element = BabySizeSection({ variant: 'pregnant', ga: pregnantGa });

      // There must still be a View with accessibilityRole="text" for screen-reader summary.
      const accessibleView = findFirst(
        element,
        (el) => el.type === 'View' && (el.props as Record<string, unknown>).accessibilityRole === 'text',
      );
      expect(accessibleView).not.toBeNull(); // Ensure accessible content still exists

      // The disclaimer link must NOT be a descendant of that accessible View.
      const linkInsideAccessibleView = accessibleView
        ? findFirst(accessibleView, (el) => el.type === 'TouchableOpacity')
        : null;

      // FAILS before fix — link IS inside the outer section View that has accessibilityRole="text"
      // PASSES after fix  — link is outside; only the content-row has accessibilityRole="text"
      expect(linkInsideAccessibleView).toBeNull();
    });

    it('postpartum variant: disclaimer TouchableOpacity is NOT inside a View with accessibilityRole="text"', () => {
      const element = BabySizeSection({ variant: 'postpartum', pp: postpartumPp });

      const accessibleView = findFirst(
        element,
        (el) => el.type === 'View' && (el.props as Record<string, unknown>).accessibilityRole === 'text',
      );
      expect(accessibleView).not.toBeNull();

      const linkInsideAccessibleView = accessibleView
        ? findFirst(accessibleView, (el) => el.type === 'TouchableOpacity')
        : null;

      expect(linkInsideAccessibleView).toBeNull();
    });
  });

  describe('[RED→GREEN] disclaimer link must have testID "baby-size-disclaimer-link"', () => {
    /**
     * A missing testID means the link cannot be found by E2E / Maestro tests.
     * Adding the testID is part of the fix and proves the link is properly exposed
     * as an individually accessible element.
     *
     * BEFORE FIX: no testID on the TouchableOpacity → FAILS.
     * AFTER FIX:  testID="baby-size-disclaimer-link" added → PASSES.
     */
    it('pregnant variant: disclaimer link has testID', () => {
      const element = BabySizeSection({ variant: 'pregnant', ga: pregnantGa });

      const link = findFirst(
        element,
        (el) =>
          el.type === 'TouchableOpacity' &&
          (el.props as Record<string, unknown>).testID === 'baby-size-disclaimer-link',
      );

      expect(link).not.toBeNull();
    });

    it('postpartum variant: disclaimer link has testID', () => {
      const element = BabySizeSection({ variant: 'postpartum', pp: postpartumPp });

      const link = findFirst(
        element,
        (el) =>
          el.type === 'TouchableOpacity' &&
          (el.props as Record<string, unknown>).testID === 'baby-size-disclaimer-link',
      );

      expect(link).not.toBeNull();
    });
  });

  // ── GUARD: verify onPress wiring is correct (passes before AND after fix) ──

  describe('GUARD: onPress → setModalVisible(true) wiring', () => {
    it('pregnant: pressing disclaimer link calls setModalVisible(true)', () => {
      const element = BabySizeSection({ variant: 'pregnant', ga: pregnantGa });

      // Find any TouchableOpacity with an onPress handler (the disclaimer link)
      const link = findFirst(
        element,
        (el) =>
          el.type === 'TouchableOpacity' &&
          typeof (el.props as Record<string, unknown>).onPress === 'function',
      );

      expect(link).not.toBeNull();

      const onPress = (link!.props as Record<string, unknown>).onPress as () => void;
      onPress();

      expect(capturedSetModalVisible).toHaveBeenCalledWith(true);
    });

    it('postpartum: pressing disclaimer link calls setModalVisible(true)', () => {
      const element = BabySizeSection({ variant: 'postpartum', pp: postpartumPp });

      const link = findFirst(
        element,
        (el) =>
          el.type === 'TouchableOpacity' &&
          typeof (el.props as Record<string, unknown>).onPress === 'function',
      );

      expect(link).not.toBeNull();

      const onPress = (link!.props as Record<string, unknown>).onPress as () => void;
      onPress();

      expect(capturedSetModalVisible).toHaveBeenCalledWith(true);
    });

    it('pregnant: DisclaimerModal receives title key "home.babySizeDisclaimerModalTitle" and visible=false initially', () => {
      const element = BabySizeSection({ variant: 'pregnant', ga: pregnantGa });

      // DisclaimerModal is a local function component; find by checking props shape
      const modal = findFirst(
        element,
        (el) =>
          typeof el.type === 'function' &&
          'visible' in (el.props as object) &&
          'onClose' in (el.props as object),
      );

      expect(modal).not.toBeNull();
      expect((modal!.props as Record<string, unknown>).title).toBe(
        'home.babySizeDisclaimerModalTitle',
      );
      expect((modal!.props as Record<string, unknown>).visible).toBe(false);
    });

    it('postpartum: DisclaimerModal receives title key "home.babySizeDisclaimerModalTitle" and visible=false initially', () => {
      const element = BabySizeSection({ variant: 'postpartum', pp: postpartumPp });

      const modal = findFirst(
        element,
        (el) =>
          typeof el.type === 'function' &&
          'visible' in (el.props as object) &&
          'onClose' in (el.props as object),
      );

      expect(modal).not.toBeNull();
      expect((modal!.props as Record<string, unknown>).title).toBe(
        'home.babySizeDisclaimerModalTitle',
      );
      expect((modal!.props as Record<string, unknown>).visible).toBe(false);
    });
  });
});
