/**
 * consentScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B1 reskin — ConsentScreen
 *
 * CRITICAL design-reviewer gate for B1:
 *   ConsentScreen PDPA trust-marker rows use type.caption (13sp) + text.primary
 *   (roselle-700, 7.70:1) — NO jade-600 below 15sp, NO #94818A anywhere.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  Switch: 'Switch', ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Modal: 'Modal', ActivityIndicator: 'ActivityIndicator', SafeAreaView: 'SafeAreaView',
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]), useEffect: jest.fn(), useCallback: jest.fn((f: unknown) => f) };
});

jest.mock('../i18n/LanguageContext', () => ({ useT: () => ({ t: (k: string) => k, locale: 'th' }) }));
jest.mock('../consent/consentApiClient', () => ({ createConsentApiClient: jest.fn(() => ({})) }));
jest.mock('../consent/consentStore', () => ({ consentStore: { setGranted: jest.fn() } }));
jest.mock('../consent/consentSync', () => ({ consentQueue: { hasPendingEntry: jest.fn(() => false), enqueue: jest.fn(), persist: jest.fn() } }));

import React from 'react';
import { ConsentScreen } from './ConsentScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(() => Promise.resolve(null)), save: jest.fn(), clear: jest.fn() };

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

const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  onContinue: jest.fn(),
};

describe('ConsentScreen — ห้องแม่ Phase 2 B1 reskin', () => {
  let tree: React.ReactElement;
  beforeEach(() => { tree = ConsentScreen(baseProps) as React.ReactElement; });

  it('no elements use IBMPlexSans', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('DESIGN-REVIEWER GATE: no elements use banned #94818A (cardCaption/caption/changeLaterNote/offNote)', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use white bg #FFFFFF (cards must use surface.subtle)', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/700 #8E3A44', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    })).toHaveLength(0);
  });

  it('no elements use raw hex #5F4A52 or #3A2A30', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52' || s.color === '#3A2A30'
        || s.backgroundColor === '#5F4A52' || s.backgroundColor === '#3A2A30';
    })).toHaveLength(0);
  });

  it('root bg is surface.base', () => {
    const s = flat((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });

  it('continue button bg is amber-700 T.button.primary.bg NOT #A8505A', () => {
    const btn = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'consent-screen-continue-btn')[0];
    expect(btn).toBeDefined();
    const s = flat((btn.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.button.primary.bg);
    expect(s.backgroundColor).not.toBe('#A8505A');
  });

  it('continue button height is ≥52dp', () => {
    const btn = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'consent-screen-continue-btn')[0];
    const s = flat((btn.props as Record<string, unknown>).style);
    const h = s.minHeight ?? s.height;
    expect(Number(h)).toBeGreaterThanOrEqual(52);
  });

  it('Switch trackColor false is T.color.surface.divider (not #EBE1D9)', () => {
    const sw = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'consent-screen-cloud-storage-toggle')[0];
    expect(sw).toBeDefined();
    const tc = (sw.props as Record<string, unknown>).trackColor as Record<string, string>;
    expect(tc.false).toBe(T.color.surface.divider);
  });

  it('Switch trackColor true is T.color.accent.interactive (not #A8505A)', () => {
    const sw = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'consent-screen-cloud-storage-toggle')[0];
    const tc = (sw.props as Record<string, unknown>).trackColor as Record<string, string>;
    expect(tc.true).toBe(T.color.accent.interactive);
    expect(tc.true).not.toBe('#A8505A');
  });

  it('no elements use old stale border #EBE1D9', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderColor === '#EBE1D9';
    })).toHaveLength(0);
  });
});
