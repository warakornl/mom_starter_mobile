/**
 * deleteAccountSheet.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — DeleteAccountSheet
 *
 * Key rule: confirm CTA = T.button.primary.bg (amber-700), NOT rose/700 (#9B1C35).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput', Modal: 'Modal', ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (o: unknown) => o },
  Platform: { OS: 'ios' }, AccessibilityInfo: { announceForAccessibility: jest.fn() },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useEffect: jest.fn(),
    useRef: jest.fn(() => ({ current: false })),
  };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./confirmWordMatch', () => ({
  matchesConfirmWord: jest.fn((input: string) => input === 'ลบ'),
  CONFIRM_WORDS: { th: 'ลบ', en: 'DELETE' },
}));

import React from 'react';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { T } from '../theme/tokens';

const baseProps = {
  visible: true,
  locale: 'th' as const,
  confirmInput: '',
  onConfirmInputChange: jest.fn(),
  deleteInFlight: false,
  deleteError: null,
  stepUpDegraded: false,
  onConfirmTap: jest.fn(),
  onCancelTap: jest.fn(),
  onNudgeDownloadTap: jest.fn(),
  onNudgeSkipTap: jest.fn(),
  onRetryTap: jest.fn(),
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

describe('DeleteAccountSheet — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return; // visible=false guard
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use old rose-700 #9B1C35 (destructive red)', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#9B1C35' || s.backgroundColor === '#9B1C35' || s.borderColor === '#9B1C35';
    })).toHaveLength(0);
  });

  it('no elements use banned ink-faint #94818A', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use banned ink-soft #5F4A52', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as nested bg', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use placeholderTextColor #94818A', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.placeholderTextColor === '#94818A';
    })).toHaveLength(0);
  });

  it('confirm button bg is T.button.primary.bg amber-700 NOT #9B1C35', () => {
    const tree = DeleteAccountSheet(baseProps) as React.ReactElement;
    if (tree == null) return;
    const btn = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'delete-sheet-confirm-btn';
    })[0];
    expect(btn).toBeDefined();
    const styleArr = (btn.props as Record<string, unknown>).style as unknown[];
    const base = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
    expect(base.backgroundColor).toBe(T.button.primary.bg);
    expect(base.backgroundColor).not.toBe('#9B1C35');
  });
});
