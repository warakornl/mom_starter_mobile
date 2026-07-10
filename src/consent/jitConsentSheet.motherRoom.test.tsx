/**
 * jitConsentSheet.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — JitConsentSheet
 *
 * Key fix: 'Looped-SemiBold' → 'Sarabun-SemiBold' (wrong font in title).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal', ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./jitConsentLogic', () => ({
  requiresParentalAttestation: jest.fn(() => false),
  isGrantEnabled: jest.fn(() => true),
}));
jest.mock('./jitConsentSheetLogic', () => ({
  JIT_SHEET_TESTID: { pdf_egress: 'consent-jit-sheet-pdf_egress' },
  JIT_GRANT_BTN_TESTID: { pdf_egress: 'consent-jit-grant-pdf_egress' },
  JIT_DECLINE_BTN_TESTID: { pdf_egress: 'consent-jit-decline-pdf_egress' },
  JIT_ERROR_PANEL_TESTID: { pdf_egress: 'consent-jit-error-panel-pdf_egress' },
  JIT_RETRY_BTN_TESTID: { pdf_egress: 'consent-jit-retry-pdf_egress' },
  JIT_PARENTAL_ATTEST_TESTID: { pdf_egress: null },
}));

import React from 'react';
import { JitConsentSheet } from './JitConsentSheet';
import { T } from '../theme/tokens';

const baseProps = {
  type: 'pdf_egress' as const,
  visible: true,
  isLoading: false,
  error: null,
  onGrant: jest.fn(),
  onDecline: jest.fn(),
  onRetry: jest.fn(),
  parentalAttested: false,
  onParentalAttest: jest.fn(),
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

describe('JitConsentSheet — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use wrong font Looped-SemiBold', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.fontFamily === 'Looped-SemiBold';
    })).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/700 #8E3A44', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as sheet bg', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old disabled #D4B8BC', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#D4B8BC';
    })).toHaveLength(0);
  });

  it('grant button bg is T.button.primary.bg amber-700', () => {
    const tree = JitConsentSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    const grantBtns = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.button.primary.bg;
    });
    expect(grantBtns.length).toBeGreaterThan(0);
  });
});
