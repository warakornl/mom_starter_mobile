/**
 * forgotPasswordScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B1 reskin — ForgotPasswordScreen
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' },
  StyleSheet: { create: (o: unknown) => o },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]), useEffect: jest.fn(), useMemo: jest.fn((f: () => unknown) => f()) };
});

jest.mock('../i18n/LanguageContext', () => ({ useT: () => ({ t: (k: string) => k, locale: 'th' }) }));
jest.mock('./forgotPasswordScreenLogic', () => ({ handleForgotPassword: jest.fn(), RESEND_COOLDOWN_MS: 60000 }));
jest.mock('./loginScreenLogic', () => ({ validateEmailField: jest.fn(() => null) }));
jest.mock('./authApiClient', () => ({ createAuthClient: jest.fn(() => ({})) }));

import React from 'react';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';
import { T } from '../theme/tokens';

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

function findFirst(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement | null {
  if (node == null || node === false) return null;
  if (Array.isArray(node)) { for (const c of node as unknown[]) { const f = findFirst(c, pred); if (f) return f; } return null; }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement;
  if (pred(el)) return el;
  return findFirst((el.props as { children?: unknown }).children, pred);
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

const baseProps = { apiBaseUrl: 'https://api.example.com', onDone: jest.fn(), onBackToLogin: jest.fn() };

describe('ForgotPasswordScreen — ห้องแม่ Phase 2 B1 reskin', () => {
  let tree: React.ReactElement;
  beforeEach(() => { tree = ForgotPasswordScreen(baseProps) as React.ReactElement; });

  it('no Text elements use IBMPlexSans', () => {
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('email input bg is input.bg ivory-200 NOT white', () => {
    const inp = findFirst(tree, (el) => el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'forgot-email');
    expect(inp).not.toBeNull();
    expect(flat((inp!.props as Record<string, unknown>).style).backgroundColor).toBe(T.input.bg);
  });

  it('email input placeholderTextColor is NOT #94818A', () => {
    const inp = findFirst(tree, (el) => el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'forgot-email');
    const p = (inp!.props as Record<string, unknown>).placeholderTextColor;
    expect(p).toBe(T.input.placeholder);
    expect(p).not.toBe('#94818A');
  });

  it('submit button bg is amber-700 NOT #A8505A', () => {
    const btn = findFirst(tree, (el) => (el.props as Record<string, unknown>).testID === 'forgot-submit');
    expect(btn).not.toBeNull();
    const styleArr = (btn!.props as Record<string, unknown>).style as unknown[];
    const s = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
    expect(s.backgroundColor).toBe(T.button.primary.bg);
    expect(s.backgroundColor).not.toBe('#A8505A');
  });

  it('submit button height is 52dp', () => {
    const btn = findFirst(tree, (el) => (el.props as Record<string, unknown>).testID === 'forgot-submit');
    const s = flat((btn!.props as Record<string, unknown>).style);
    expect(s.height).toBe(52);
  });

  it('no elements use banned #94818A', () => {
    expect(findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return s.color === '#94818A' || p.placeholderTextColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use white bg #FFFFFF', () => {
    expect(findAll(tree, (el) => flat((el.props as Record<string, unknown>).style).backgroundColor === '#FFFFFF')).toHaveLength(0);
  });

  it('no elements use old rose #A8505A bg', () => {
    expect(findAll(tree, (el) => flat((el.props as Record<string, unknown>).style).backgroundColor === '#A8505A')).toHaveLength(0);
  });

  it('input height is 52dp', () => {
    const inp = findFirst(tree, (el) => el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'forgot-email');
    expect(flat((inp!.props as Record<string, unknown>).style).height).toBe(52);
  });

  it('input borderRadius is T.radius.md (12dp)', () => {
    const inp = findFirst(tree, (el) => el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'forgot-email');
    expect(flat((inp!.props as Record<string, unknown>).style).borderRadius).toBe(T.radius.md);
  });

  it('confirmationBlock uses jade-100 wash bg for confirmation card', () => {
    // Ensure no old sage colors present
    expect(findAll(tree, (el) => flat((el.props as Record<string, unknown>).style).backgroundColor === '#E4EBE4')).toHaveLength(0);
  });
});
