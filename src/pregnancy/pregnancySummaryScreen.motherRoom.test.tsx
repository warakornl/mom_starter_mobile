/**
 * pregnancySummaryScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — PregnancySummaryScreen
 *
 * Includes:
 *  - Token migration (no IBMPlex, no banned hex, no deprecated aliases)
 *  - Loss gate: partialNote suppressed when lifecycle='ended' (rollout §3)
 *  - FAIL-ON-REVERT: removing the gate makes the LOSS-GATE test RED
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Modal: 'Modal', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('../i18n/messages', () => ({ formatCivilDate: jest.fn((d: string) => d) }));
jest.mock('./pregnancySummary', () => ({
  buildPregnancySummary: jest.fn(() => ({
    needsEdd: false,
    T1: { kicks: null, medications: [] },
    T2: { kicks: null, medications: [] },
    T3: { kicks: null, medications: [] },
    delivery: null,
  })),
}));
jest.mock('../kickCount/kickCountSyncStore', () => ({
  kickCountSyncStore: { getCompletedSessions: jest.fn(() => []) },
}));
jest.mock('../medication/medicationLogSyncStore', () => ({
  medicationLogSyncStore: { getLogs: jest.fn(() => []) },
}));
jest.mock('../medication/medicationPlanSyncStore', () => ({
  medicationPlanSyncStore: { getPlans: jest.fn(() => []) },
}));
jest.mock('./nameFieldCipher', () => ({ decodeNameFromWire: jest.fn((v: string) => v) }));
jest.mock('./gestationalAge', () => ({ localCivilToday: jest.fn(() => '2026-07-10') }));

import React from 'react';
import { PregnancySummaryScreen } from './PregnancySummaryScreen';
import { T } from '../theme/tokens';
import type { Lifecycle } from './types';

const baseProps = {
  edd: '2026-12-01',
  birthDate: null,
  deliveryType: null,
  hospitalAdmissionDate: null,
  hospitalDischargeDate: null,
};

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false) return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node); return acc;
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

describe('PregnancySummaryScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  // ─── Token migration tests ────────────────────────────────────────────────

  it('no elements use IBMPlexSans', () => {
    const tree = PregnancySummaryScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = PregnancySummaryScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use banned rose #9B1C35', () => {
    const tree = PregnancySummaryScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#9B1C35' || s.backgroundColor === '#9B1C35';
    })).toHaveLength(0);
  });

  it('no section labels have textTransform uppercase', () => {
    const tree = PregnancySummaryScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.textTransform === 'uppercase';
    })).toHaveLength(0);
  });

  it('no elements use rgba(0,0,0,0.4) scrim — must use T.scrim.color', () => {
    const tree = PregnancySummaryScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === 'rgba(0,0,0,0.4)';
    })).toHaveLength(0);
  });

  // ─── Loss gate: partialNote suppression when lifecycle = 'ended' ──────────
  //
  // FAIL-ON-REVERT: removing `if (lifecycle === 'ended') return null` from the
  // partialNote guard makes the LOSS-GATE test RED (note appears when it must not).

  it('LOSS-GATE: partialNote is SUPPRESSED when lifecycle="ended" and birthDate=null', () => {
    const tree = PregnancySummaryScreen({
      ...baseProps,
      lifecycle: 'ended' as Lifecycle,
    }) as React.ReactElement;
    const notes = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'pregnancy-summary-partial-note';
    });
    expect(notes).toHaveLength(0);
  });

  it('FAIL-ON-REVERT: partialNote IS shown when lifecycle="pregnant" and birthDate=null', () => {
    const tree = PregnancySummaryScreen({
      ...baseProps,
      lifecycle: 'pregnant' as Lifecycle,
    }) as React.ReactElement;
    const notes = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'pregnancy-summary-partial-note';
    });
    expect(notes.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: partialNote IS shown when lifecycle is undefined and birthDate=null', () => {
    const tree = PregnancySummaryScreen(baseProps) as React.ReactElement;
    const notes = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'pregnancy-summary-partial-note';
    });
    expect(notes.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: lifecycle prop is accepted (interface has lifecycle key)', () => {
    // If the prop is removed from the interface, TypeScript would flag this,
    // but here we verify the prop can be passed without error at runtime.
    expect(() => {
      PregnancySummaryScreen({ ...baseProps, lifecycle: 'ended' as Lifecycle });
    }).not.toThrow();
  });
});
