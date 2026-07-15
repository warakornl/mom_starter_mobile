/**
 * milestoneHeroIllustration.motherRoom.test.tsx
 * TDD: ห้องแม่ CLUSTER 2 UX/UI review fixes — MilestoneHeroIllustration.
 *
 * Covers:
 *  - FAIL-ON-REVERT: the dead `progress` Animated.Value / Animated.timing /
 *    AccessibilityInfo.isReduceMotionEnabled() machinery is removed, not
 *    silently left driving nothing. This is proven by NOT mocking
 *    'react-native' at all in this test — if the component still imported
 *    Animated/AccessibilityInfo/useEffect/useState from 'react-native'/'react'
 *    (undeclared in this test's jest.mock), the require() below would throw
 *    (real react-native's Animated/AccessibilityInfo need the full native
 *    turbo-module registry, which is unavailable in the plain ts-jest/node
 *    environment) — so a successful render here is itself the regression
 *    guard.
 *  - The component still renders a valid <Svg> tree with the color prop wired
 *    through to at least one <Path stroke=...>.
 */

jest.mock('react-native-svg', () => {
  const mkC = (n: string) => n;
  return {
    default: mkC('Svg'), Svg: mkC('Svg'),
    Path: mkC('Path'), G: mkC('G'),
  };
});

import React from 'react';
import { MilestoneHeroIllustration } from './MilestoneHeroIllustration';

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

describe('MilestoneHeroIllustration — dead animation removed', () => {
  it('FAIL-ON-REVERT: renders synchronously with NO react-native Animated/AccessibilityInfo mock required', () => {
    // If this component still imported Animated/AccessibilityInfo (the dead
    // code path), calling it here — with react-native completely un-mocked —
    // would throw inside the real react-native package (no native modules
    // registered in this environment). A clean render proves the dead
    // Animated wiring was actually deleted, not just visually unused.
    expect(() => MilestoneHeroIllustration({})).not.toThrow();
  });

  it('renders an Svg tree with the color prop applied to Path strokes', () => {
    const tree = MilestoneHeroIllustration({ color: '#2F5042' }) as React.ReactElement;
    expect(React.isValidElement(tree)).toBe(true);
    const paths = findAll(tree, (el) => el.type === 'Path');
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect((p.props as Record<string, unknown>).stroke).toBe('#2F5042');
    }
  });

  it('accepts the `animated` prop without error (backward-compat no-op)', () => {
    expect(() => MilestoneHeroIllustration({ animated: true })).not.toThrow();
    expect(() => MilestoneHeroIllustration({ animated: false })).not.toThrow();
  });
});
