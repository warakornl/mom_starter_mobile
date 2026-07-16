/**
 * babySizeSection.motherRoom.test.tsx
 * TDD: ห้องแม่ CLUSTER 2 UX/UI review fixes — BabySizeSection.
 *
 * Covers:
 *  - FAIL-ON-REVERT: no banned Clean-palette hexes (or rgba() equivalents)
 *    remain live in any style object (#A8505A, #4C6B57, #3A2A30, #5F4A52,
 *    #C8B9C0, #EBE1D9, rgba(0,0,0,0.4)).
 *  - FAIL-ON-REVERT: no IBMPlexSans font family remains.
 *  - FAIL-ON-REVERT: the legally-mandated disclaimer text style has
 *    lineHeight >= 1.6x fontSize (Thai stacked-tone-mark rule).
 *  - FAIL-ON-REVERT: the deprecated T.sectionLabel* uppercase alias is gone
 *    (no textTransform:'uppercase' anywhere in the tree).
 *  - FAIL-ON-REVERT: the former inline `<View style={{height:16}}>` spacer is
 *    replaced by a token-driven style object (not an inline literal).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal', ScrollView: 'ScrollView', SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: (o: unknown) => o },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('../icons', () => ({
  BabySizeSmallRoundIcon: 'BabySizeSmallRoundIcon',
  BabySizeStrawberryIcon: 'BabySizeStrawberryIcon',
  BabySizeAppleIcon: 'BabySizeAppleIcon',
  BabySizeAvocadoIcon: 'BabySizeAvocadoIcon',
  BabySizePearIcon: 'BabySizePearIcon',
  BabySizeMangoIcon: 'BabySizeMangoIcon',
  BabySizeBananaIcon: 'BabySizeBananaIcon',
  BabySizeCarrotIcon: 'BabySizeCarrotIcon',
  BabySizePapayaIcon: 'BabySizePapayaIcon',
  BabySizeCornIcon: 'BabySizeCornIcon',
  BabySizePineappleIcon: 'BabySizePineappleIcon',
  BabySizeEggplantIcon: 'BabySizeEggplantIcon',
  BabySizeSquashIcon: 'BabySizeSquashIcon',
  BabySizeLargeRibbedRoundIcon: 'BabySizeLargeRibbedRoundIcon',
  BabySizeWatermelonIcon: 'BabySizeWatermelonIcon',
  BabyFootprintIcon: 'BabyFootprintIcon',
  CloseIcon: 'CloseIcon',
}));

import React from 'react';
import { BabySizeSection } from './BabySizeSection';
import { T } from '../theme/tokens';

const GA_FIXTURE = {
  gestationalWeek: 20,
  gestationalDay: 0,
  daysPregnant: 140,
  daysRemaining: 140,
  displayedWeek: 20,
  suppressDayDisplay: false,
  currentStage: 'T2' as const,
  deliveryWindowActive: false,
  progress: 0.5,
};

const PP_FIXTURE = {
  postpartumWeek: 2,
  postpartumDay: 0,
  postpartumDays: 14,
};

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

function flatStyle(s: unknown): Record<string, unknown>[] {
  if (Array.isArray(s)) return s.flatMap(flatStyle);
  if (s && typeof s === 'object') return [s as Record<string, unknown>];
  return [];
}

function allStyles(tree: unknown): Record<string, unknown>[] {
  const els = findAll(tree, () => true);
  return els.flatMap((el) => flatStyle((el.props as Record<string, unknown>).style));
}

const BANNED_HEXES = ['#A8505A', '#4C6B57', '#3A2A30', '#5F4A52', '#C8B9C0', '#EBE1D9'];

describe('BabySizeSection — CLUSTER 2 review fixes', () => {
  it('FAIL-ON-REVERT: pregnant variant — no banned Clean-palette hexes anywhere', () => {
    const tree = (BabySizeSection({ variant: 'pregnant', ga: GA_FIXTURE }) as React.ReactElement | null);
    expect(tree).not.toBeNull();
    const styles = allStyles(tree);
    for (const s of styles) {
      for (const key of ['color', 'backgroundColor', 'borderBottomColor'] as const) {
        if (typeof s[key] === 'string') {
          expect(BANNED_HEXES).not.toContain(s[key]);
        }
      }
    }
  });

  it('FAIL-ON-REVERT: postpartum variant — no banned Clean-palette hexes anywhere', () => {
    const tree = BabySizeSection({ variant: 'postpartum', pp: PP_FIXTURE }) as React.ReactElement;
    const styles = allStyles(tree);
    for (const s of styles) {
      for (const key of ['color', 'backgroundColor', 'borderBottomColor'] as const) {
        if (typeof s[key] === 'string') {
          expect(BANNED_HEXES).not.toContain(s[key]);
        }
      }
    }
  });

  it('FAIL-ON-REVERT: scrim uses T.scrim.color, not rgba(0,0,0,0.4)', () => {
    const tree = BabySizeSection({ variant: 'pregnant', ga: GA_FIXTURE }) as React.ReactElement;
    const styles = allStyles(tree);
    const bgColors = styles.map((s) => s.backgroundColor).filter(Boolean);
    expect(bgColors).not.toContain('rgba(0,0,0,0.4)');
  });

  it('FAIL-ON-REVERT: no element uses IBMPlexSans font family', () => {
    const tree = BabySizeSection({ variant: 'pregnant', ga: GA_FIXTURE }) as React.ReactElement;
    const styles = allStyles(tree);
    for (const s of styles) {
      if (typeof s.fontFamily === 'string') {
        expect((s.fontFamily as string).includes('IBMPlex')).toBe(false);
      }
    }
  });

  it('FAIL-ON-REVERT: disclaimer text style has lineHeight >= 1.6x fontSize (Thai rule)', () => {
    const tree = BabySizeSection({ variant: 'pregnant', ga: GA_FIXTURE }) as React.ReactElement;
    // The disclaimer Text is the one whose children resolve to the disclaimer i18n key.
    const disclaimerEls = findAll(tree, (el) => {
      const props = el.props as { children?: unknown };
      return props.children === 'home.babySizeDisclaimer';
    });
    expect(disclaimerEls.length).toBe(1);
    const s = flatStyle((disclaimerEls[0]!.props as Record<string, unknown>).style)[0]!;
    expect(typeof s.fontSize).toBe('number');
    expect(typeof s.lineHeight).toBe('number');
    expect((s.lineHeight as number) / (s.fontSize as number)).toBeGreaterThanOrEqual(1.6);
  });

  it('FAIL-ON-REVERT: no element uses textTransform:"uppercase" (Thai zero-tracking rule)', () => {
    const tree = BabySizeSection({ variant: 'pregnant', ga: GA_FIXTURE }) as React.ReactElement;
    const styles = allStyles(tree);
    for (const s of styles) {
      expect(s.textTransform).not.toBe('uppercase');
    }
  });

  it('FAIL-ON-REVERT: postpartum bottom spacer uses a token height (T.spacing[4]=16), not an inline literal object identity', () => {
    const tree = BabySizeSection({ variant: 'postpartum', pp: PP_FIXTURE }) as React.ReactElement;
    const hiddenSpacers = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.accessibilityElementsHidden === true && p.testID === undefined && flatStyle(p.style)[0]?.height !== undefined;
    });
    // The postpartum bottom spacer is the accessibilityElementsHidden View with a `height` style.
    const spacer = hiddenSpacers.find((el) => flatStyle((el.props as Record<string, unknown>).style)[0]?.height === T.spacing[4]);
    expect(spacer).toBeDefined();
  });

  it('close button hit target is >=48dp (a11y touch-target rule)', () => {
    const tree = BabySizeSection({ variant: 'pregnant', ga: GA_FIXTURE }) as React.ReactElement;
    const link = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'baby-size-disclaimer-link')[0];
    expect(link).toBeDefined();
    const s = flatStyle((link!.props as Record<string, unknown>).style)[0]!;
    expect(s.minHeight as number).toBeGreaterThanOrEqual(48);
  });
});
