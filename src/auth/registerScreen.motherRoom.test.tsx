/**
 * registerScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B1 reskin — RegisterScreen
 * Same pattern as loginScreen.motherRoom.test.tsx.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg', Svg: 'Svg', Path: 'Path', Circle: 'Circle', Rect: 'Rect',
  Line: 'Line', G: 'G', Ellipse: 'Ellipse',
}));

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (o: unknown) => o },
}));

jest.mock('react', () => {
  const actualReact = jest.requireActual('react') as typeof import('react');
  return {
    ...actualReact,
    useState: jest.fn((init: unknown) => [init, jest.fn()]),
    useEffect: jest.fn(),
    useMemo: jest.fn((factory: () => unknown) => factory()),
  };
});

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('./registerScreenLogic', () => ({
  validateEmailField: jest.fn(() => null),
  validatePasswordField: jest.fn(() => true),
  handleRegister: jest.fn(),
}));

jest.mock('./authApiClient', () => ({
  createAuthClient: jest.fn(() => ({})),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { RegisterScreen } from './RegisterScreen';
import { T } from '../theme/tokens';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  walk(node);
  return acc;
}

function findFirst(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement | null {
  if (node == null || node === false) return null;
  if (Array.isArray(node)) {
    for (const c of node as unknown[]) { const f = findFirst(c, pred); if (f) return f; }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement;
  if (pred(el)) return el;
  return findFirst((el.props as { children?: unknown }).children, pred);
}

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  if (style && typeof style === 'object') return style as Record<string, unknown>;
  return {};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RegisterScreen — ห้องแม่ Phase 2 B1 reskin', () => {
  const baseProps = {
    apiBaseUrl: 'https://api.example.com',
    onSuccess: jest.fn(),
    onSignIn: jest.fn(),
  };

  let tree: React.ReactElement;
  beforeEach(() => {
    tree = RegisterScreen(baseProps) as React.ReactElement;
  });

  it('no Text/TextInput elements use IBMPlexSans font family', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    });
    expect(bad).toHaveLength(0);
  });

  it('email input bg is input.bg ivory-200 (NOT white)', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'register-email',
    );
    expect(emailInput).not.toBeNull();
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.input.bg);
    expect(s.backgroundColor).not.toBe('#FFFFFF');
  });

  it('email input placeholderTextColor is input.placeholder NOT #94818A', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'register-email',
    );
    const p = (emailInput!.props as Record<string, unknown>).placeholderTextColor;
    expect(p).toBe(T.input.placeholder);
    expect(p).not.toBe('#94818A');
  });

  it('submit button base bg is T.button.primary.bg amber-700', () => {
    const btn = findFirst(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'register-submit',
    );
    expect(btn).not.toBeNull();
    const styleArr = (btn!.props as Record<string, unknown>).style as unknown[];
    const baseStyle = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
    expect(baseStyle.backgroundColor).toBe(T.button.primary.bg);
    expect(baseStyle.backgroundColor).not.toBe('#A8505A');
  });

  it('no elements use banned #94818A', () => {
    const bad = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return s.color === '#94818A' || p.placeholderTextColor === '#94818A';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use white bg #FFFFFF', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old rose bg #A8505A', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#A8505A';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old rose disabled #DDA0A6', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#DDA0A6';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old hairline #EBE1D9 as borderColor', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderColor === '#EBE1D9';
    });
    expect(bad).toHaveLength(0);
  });

  it('flex root bg is surface.base #FBF6F1', () => {
    const s = flat((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });

  it('input height is 52dp', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'register-email',
    );
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.height).toBe(52);
  });

  it('input borderRadius is T.radius.md (12dp)', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'register-email',
    );
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.borderRadius).toBe(T.radius.md);
  });
});
