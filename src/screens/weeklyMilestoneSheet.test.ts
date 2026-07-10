/**
 * weeklyMilestoneSheet.test.ts — Real render tests for WeeklyMilestoneSheet (§4.2)
 *
 * Spec: docs/design/mother-room-build-spec.md §4.2
 *
 * Approach: call WeeklyMilestoneSheet as a plain function (same pattern as
 * babySizeSection.disclaimerModal.test.ts) and traverse the returned React
 * element tree with findFirst. All external deps are mocked so the function
 * executes synchronously in a pure-Node environment.
 *
 * Tests:
 *   1. [RENDER] Loss state: "ลูกของคุณ" section ABSENT when isLoss=true (fail-on-revert)
 *   2. [RENDER] No-loss state: "ลูกของคุณ" section PRESENT when isLoss=false
 *   3. [RENDER] CTA "เขียนบันทึกวันนี้" calls onNavigateToCapture spy (§4.3)
 *   4. Design token assertions — §4.2 radius/elev/color spec (token, not tautological)
 *
 * Fail-on-revert contract (§3 blocking):
 *   Deleting the `{!isLoss && (...)}` guard from WeeklyMilestoneSheet makes
 *   test 1 RED: the baby-section element is found when isLoss=true → toBeNull() fails.
 */

// ─── Mocks (hoisted before imports) ───────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  StyleSheet: { create: (o: unknown) => o },
  Animated: {
    Value: class { constructor(_v: number) {} },
    timing: jest.fn(() => ({ start: jest.fn() })),
  },
  Easing: { inOut: jest.fn(), ease: jest.fn() },
  AccessibilityInfo: { isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)) },
}));

jest.mock('react-native-svg', () => {
  const mkC = (n: string) => n;
  return {
    default: mkC('Svg'), Svg: mkC('Svg'),
    Path: mkC('Path'), Circle: mkC('Circle'),
    Rect: mkC('Rect'), Line: mkC('Line'),
    G: mkC('G'), Ellipse: mkC('Ellipse'),
  };
});

jest.mock('../illustrations/MilestoneHeroIllustration', () => ({
  MilestoneHeroIllustration: 'MilestoneHeroIllustration',
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: jest.fn((k: string) => k), locale: 'th' })),
}));

// ─── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { WeeklyMilestoneSheet } from './WeeklyMilestoneSheet';
import { T } from '../theme/tokens';

// ─── Tree traversal helper ────────────────────────────────────────────────────

/**
 * findFirst — depth-first search over a React element tree.
 * Returns the first element matching predicate, or null.
 * Handles arrays, null/undefined/false (skipped), and non-element nodes.
 * Does NOT call function-component elements — only traverses props.children.
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

// ─── Shared base props ────────────────────────────────────────────────────────

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  onNavigateToCapture: jest.fn(),
};

// ─── 1. Loss-state render — "ลูกของคุณ" absent/present (§4.2 loss matrix) ─────
//
// useT mock: t(key) → key, so t('milestone.babySection') → 'milestone.babySection'.
// SectionHeading receives label={t('milestone.babySection')}, so the rendered element
// has props.label === 'milestone.babySection'. We search by that prop.
//
// FAIL-ON-REVERT: if the `{!isLoss && ...}` guard is removed, the element is found
// even when isLoss=true, causing expect(null).toBeNull() → passing but the baby
// section element would NOT be null → toBeNull() FAILS → test goes RED.

describe('WeeklyMilestoneSheet — "ลูกของคุณ" section absent in loss state (§4.2)', () => {
  it('[isLoss=true] baby section element is absent — queryByLabel returns null', () => {
    const element = WeeklyMilestoneSheet({ ...baseProps, isLoss: true });

    // SectionHeading rendered inside {!isLoss && ...} has props.label = 'milestone.babySection'
    const babySection = findFirst(
      element,
      (el) => (el.props as Record<string, unknown>).label === 'milestone.babySection',
    );

    // MUST be null — the {!isLoss} guard suppresses the whole baby section
    expect(babySection).toBeNull();
  });

  it('[isLoss=false] baby section element is present', () => {
    const element = WeeklyMilestoneSheet({ ...baseProps, isLoss: false });

    const babySection = findFirst(
      element,
      (el) => (el.props as Record<string, unknown>).label === 'milestone.babySection',
    );

    // Must be found — {!isLoss} is true so the section renders
    expect(babySection).not.toBeNull();
  });
});

// ─── 2. CTA navigation — onNavigateToCapture called on press (§4.3) ───────────

describe('WeeklyMilestoneSheet — CTA triggers onNavigateToCapture (§4.3)', () => {
  it('milestone-sheet-cta onPress calls onNavigateToCapture spy', () => {
    const navigate = jest.fn();
    const element = WeeklyMilestoneSheet({
      ...baseProps,
      onNavigateToCapture: navigate,
      isLoss: false,
    });

    // Find the CTA by testID
    const cta = findFirst(
      element,
      (el) => (el.props as Record<string, unknown>).testID === 'milestone-sheet-cta',
    );

    expect(cta).not.toBeNull();

    // Invoke the onPress handler — prove the spy is called
    const onPress = (cta!.props as Record<string, unknown>).onPress as () => void;
    onPress();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('CTA is also present in loss state (§4.2: CTA unchanged in loss)', () => {
    const navigate = jest.fn();
    const element = WeeklyMilestoneSheet({
      ...baseProps,
      onNavigateToCapture: navigate,
      isLoss: true,
    });

    const cta = findFirst(
      element,
      (el) => (el.props as Record<string, unknown>).testID === 'milestone-sheet-cta',
    );

    expect(cta).not.toBeNull();

    const onPress = (cta!.props as Record<string, unknown>).onPress as () => void;
    onPress();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

// ─── 3. Design tokens (§4.2 layout spec) ──────────────────────────────────────

describe('WeeklyMilestoneSheet — design tokens (§4.2)', () => {
  it('T.radius.lg is 20dp (top corner radius for bottom sheet; §4.2)', () => {
    expect(T.radius.lg).toBe(20);
  });

  it('T.color.surface.base is #FBF6F1 (sheet background = screen background; §4.2)', () => {
    expect(T.color.surface.base).toBe('#FBF6F1');
  });

  it('T.elev[2].elevation is 8 (elev/2 for sheet shadow; §4.2)', () => {
    expect(T.elev[2].elevation).toBe(8);
  });

  it('T.elev[2].shadowRadius is 24 (blur24 direct in RN; §4.2 "y8 blur24")', () => {
    expect(T.elev[2].shadowRadius).toBe(24);
  });

  it('T.button.primary.bg is amber-700 #9A5F0A (sheet CTA; §4.2)', () => {
    expect(T.button.primary.bg).toBe('#9A5F0A');
  });

  it('T.button.primary.height is 52dp (sheet CTA height; §4.2)', () => {
    expect(T.button.primary.height).toBe(52);
  });

  it('drag handle color: T.color.surface.subtle is ivory-200 #F5EDE6 (§4.2)', () => {
    expect(T.color.surface.subtle).toBe('#F5EDE6');
  });
});

// ─── 4. Section label tokens (§4.2) ───────────────────────────────────────────

describe('WeeklyMilestoneSheet — section label tokens (§4.2)', () => {
  it('section labels use type.label.size (15sp; §4.2 + §0 R4 ≥15sp ✓)', () => {
    expect(T.type.label.size).toBe(15);
  });

  it('section label color: T.color.text.secondary is jade-600 #4A7A5C (AA at ≥15sp; §0 R4)', () => {
    expect(T.color.text.secondary).toBe('#4A7A5C');
  });

  it('baby body text is 17sp bodyLarge Sarabun-Regular (§4.2)', () => {
    expect(T.type.bodyLarge.size).toBe(17);
    expect(T.type.bodyLarge.fontFamily).toBe('Sarabun-Regular');
  });
});

// ─── 5. Botanical illustration token (§4.2 hero) ──────────────────────────────

describe('WeeklyMilestoneSheet — botanical stroke token (§4.2)', () => {
  it('T.botanical.stroke.width is 1.5dp (§4.2 botanical hero stroke)', () => {
    expect(T.botanical.stroke.width).toBe(1.5);
  });
});
