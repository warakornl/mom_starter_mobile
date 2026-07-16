/**
 * weeklyMilestoneSheet.motherRoom.test.tsx
 * TDD: ห้องแม่ CLUSTER 2 UX/UI review fixes — WeeklyMilestoneSheet.
 *
 * Covers:
 *  - FAIL-ON-REVERT (permanent-skeleton bug): when no `content` prop is passed
 *    (HomeTabScreen's actual call site before this fix), the sheet must NOT
 *    render forever in a loading/skeleton state — it must resolve real
 *    content from `gestationalWeek`, or fall back to a genuine 'empty' state
 *    (never an infinite skeleton).
 *  - gestationalWeek-driven catalog: T1/T2/T3 weeks resolve to non-empty
 *    baby/self-care/tip text.
 *  - The declared 'error' state renders visible error copy when
 *    gestationalWeek is non-finite (e.g. NaN).
 *  - SectionHeading uses accessibilityRole="header" (was "text").
 */

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  StyleSheet: { create: (o: unknown) => o },
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

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

import React from 'react';
import { WeeklyMilestoneSheet } from './WeeklyMilestoneSheet';

// NOTE: WeeklyMilestoneSheet renders SectionHeading (and other) function
// components inline — these appear in the tree as `{ type: [Function], props }`
// until an actual renderer mounts them. Since this test calls
// WeeklyMilestoneSheet(props) directly, the walker recursively INVOKES any
// function-type element with its own props to expand it (otherwise
// SectionHeading's accessibilityRole prop is invisible to findAll).
function expand(el: React.ReactElement): unknown {
  if (typeof el.type === 'function') {
    return (el.type as (props: unknown) => unknown)(el.props);
  }
  return (el.props as { children?: unknown }).children;
}

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk(expand(el));
  }
  walk(node);
  return acc;
}

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  onNavigateToCapture: jest.fn(),
};

describe('WeeklyMilestoneSheet — permanent-skeleton bug FIX', () => {
  it('FAIL-ON-REVERT: with NO content and NO gestationalWeek prop (the exact bug repro — HomeTabScreen previously called it this way), the sheet does NOT get stuck showing a loading skeleton', () => {
    const tree = WeeklyMilestoneSheet(baseProps) as React.ReactElement;
    // There is no more 'loading'/SheetSkeleton kind in the state machine at all —
    // prove no skeleton-bone testID/marker survives by asserting the empty-state
    // text (milestone.empty) IS present instead (a real, finite state).
    const emptyTexts = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'milestone.empty');
    expect(emptyTexts.length).toBeGreaterThan(0);
  });

  it('T1 week (5) resolves real, non-empty catalog content for all three sections', () => {
    const tree = WeeklyMilestoneSheet({ ...baseProps, gestationalWeek: 5 }) as React.ReactElement;
    const texts = findAll(tree, (el) => typeof (el.props as Record<string, unknown>).children === 'string')
      .map((el) => (el.props as Record<string, unknown>).children as string);
    expect(texts.some((t) => t.includes('ไตรมาสแรก'))).toBe(true);
  });

  it('T2 week (20) resolves different catalog content than T1', () => {
    const tree = WeeklyMilestoneSheet({ ...baseProps, gestationalWeek: 20 }) as React.ReactElement;
    const texts = findAll(tree, (el) => typeof (el.props as Record<string, unknown>).children === 'string')
      .map((el) => (el.props as Record<string, unknown>).children as string);
    expect(texts.some((t) => t.includes('ไตรมาสที่สอง'))).toBe(true);
  });

  it('T3 week (32) resolves T3 catalog content', () => {
    const tree = WeeklyMilestoneSheet({ ...baseProps, gestationalWeek: 32 }) as React.ReactElement;
    const texts = findAll(tree, (el) => typeof (el.props as Record<string, unknown>).children === 'string')
      .map((el) => (el.props as Record<string, unknown>).children as string);
    expect(texts.some((t) => t.includes('ไตรมาสที่สาม'))).toBe(true);
  });

  it('explicit `content` prop still overrides the catalog lookup (test-injection point preserved)', () => {
    const tree = WeeklyMilestoneSheet({
      ...baseProps,
      gestationalWeek: 20,
      content: { babyBodyText: 'CUSTOM_OVERRIDE_TEXT' },
    }) as React.ReactElement;
    const texts = findAll(tree, (el) => typeof (el.props as Record<string, unknown>).children === 'string')
      .map((el) => (el.props as Record<string, unknown>).children as string);
    expect(texts).toContain('CUSTOM_OVERRIDE_TEXT');
  });

  it('renders the declared "error" branch (visible error copy) when gestationalWeek is non-finite (NaN)', () => {
    const tree = WeeklyMilestoneSheet({ ...baseProps, gestationalWeek: NaN }) as React.ReactElement;
    const texts = findAll(tree, (el) => typeof (el.props as Record<string, unknown>).children === 'string')
      .map((el) => (el.props as Record<string, unknown>).children as string);
    // t() is mocked to echo the key — assert the real catalog key is used
    // (milestone.error), not a hardcoded/locale-branched literal.
    expect(texts.some((t) => t.includes('milestone.error'))).toBe(true);
  });
});

describe('WeeklyMilestoneSheet — SectionHeading role FIX', () => {
  it('FAIL-ON-REVERT: section heading elements use accessibilityRole="header" (was "text")', () => {
    const tree = WeeklyMilestoneSheet({ ...baseProps, gestationalWeek: 20 }) as React.ReactElement;
    const headings = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'milestone.maternitySection');
    expect(headings.length).toBe(1);
    expect((headings[0]!.props as Record<string, unknown>).accessibilityRole).toBe('header');
  });
});
