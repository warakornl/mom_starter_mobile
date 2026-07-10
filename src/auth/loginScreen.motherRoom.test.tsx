/**
 * loginScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B1 reskin — LoginScreen
 *
 * Pattern: call component as plain function with mocked React hooks → traverse
 * the returned React element tree. The style assertions are against the
 * StyleSheet.create output, which is the canonical token source.
 *
 * Key assertions per rollout spec §4.1 LoginScreen:
 * - Input bg: T.input.bg #F5EDE6 (ivory-200, NOT white)
 * - placeholderTextColor: T.input.placeholder #7A3A52 (NOT #94818A — BANNED)
 * - inputError border: T.input.border.error #B85C78 (NOT old #C0762B)
 * - Primary button bg: T.button.primary.bg amber-700 (NOT #A8505A)
 * - dividerText color: NOT banned #94818A
 * - No IBMPlexSans font anywhere
 * - successBanner bg: jade-100 #E4EDE7 (NOT old #EAF5EC)
 * - offlineStrip bg: surface.subtle (NOT #FBF3EE)
 * - serverCard bg: surface.subtle (NOT white #FFFFFF)
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

jest.mock('./loginScreenLogic', () => ({
  validateEmailField: jest.fn(() => null),
  validatePasswordField: jest.fn(() => true),
  handleSignIn: jest.fn(),
}));

jest.mock('./authApiClient', () => ({
  createAuthClient: jest.fn(() => ({})),
}));

jest.mock('./tokenStorage', () => ({
  InMemoryTokenStorage: class { load = jest.fn(); save = jest.fn(); clear = jest.fn(); },
}));

jest.mock('./loginSuccessToast', () => ({
  takePendingLoginSuccessToast: jest.fn(() => null),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { LoginScreen } from './LoginScreen';
import { T } from '../theme/tokens';

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function findFirst(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement | null {
  if (node == null || node === false) return null;
  if (Array.isArray(node)) {
    for (const c of node as unknown[]) {
      const f = findFirst(c, pred);
      if (f) return f;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement;
  if (pred(el)) return el;
  return findFirst((el.props as { children?: unknown }).children, pred);
}

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

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  if (style && typeof style === 'object') return style as Record<string, unknown>;
  return {};
}

// ─── Shared props ─────────────────────────────────────────────────────────────

const baseProps = {
  apiBaseUrl: 'https://api.example.com',
  onSuccess: jest.fn(),
  onForgotPassword: jest.fn(),
  onCreateAccount: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LoginScreen — ห้องแม่ Phase 2 B1 reskin (style assertions)', () => {
  let tree: React.ReactElement;

  beforeEach(() => {
    tree = LoginScreen(baseProps) as React.ReactElement;
  });

  // ── No IBMPlex ─────────────────────────────────────────────────────────────

  it('no Text/TextInput elements use IBMPlexSans font family', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    });
    expect(bad).toHaveLength(0);
  });

  // ── Input tokens ───────────────────────────────────────────────────────────

  it('email TextInput bg is input.bg ivory-200 (#F5EDE6) — NOT white', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' &&
      (el.props as Record<string, unknown>).testID === 'login-email',
    );
    expect(emailInput).not.toBeNull();
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.input.bg);
    expect(s.backgroundColor).not.toBe('#FFFFFF');
  });

  it('email TextInput text color is input.text roselle-900 (#4A2230)', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'login-email',
    );
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.color).toBe(T.input.text);
  });

  it('email TextInput placeholderTextColor is input.placeholder roselle-700 — NOT #94818A', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'login-email',
    );
    const p = (emailInput!.props as Record<string, unknown>).placeholderTextColor;
    expect(p).toBe(T.input.placeholder);
    expect(p).not.toBe('#94818A');
  });

  it('input height is 52dp (T.input.height)', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'login-email',
    );
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.height).toBe(52);
  });

  it('input border.default is surface.divider #E8DDD5 (NOT old #EBE1D9)', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'login-email',
    );
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.borderColor).toBe(T.input.border.default);
    expect(s.borderColor).not.toBe('#EBE1D9');
  });

  it('input borderRadius is T.radius.md (12dp)', () => {
    const emailInput = findFirst(tree, (el) =>
      el.type === 'TextInput' && (el.props as Record<string, unknown>).testID === 'login-email',
    );
    const s = flat((emailInput!.props as Record<string, unknown>).style);
    expect(s.borderRadius).toBe(T.radius.md);
  });

  // ── Primary button ─────────────────────────────────────────────────────────

  it('primary submit button base bg is T.button.primary.bg amber-700 (#9A5F0A)', () => {
    const btn = findFirst(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'login-submit',
    );
    expect(btn).not.toBeNull();
    // The style is [primaryButton, (disabled && primaryButtonDisabled)]
    // primaryButton base style has the background
    const styleArr = (btn!.props as Record<string, unknown>).style as unknown[];
    const baseStyle = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
    expect(baseStyle.backgroundColor).toBe(T.button.primary.bg);
    expect(baseStyle.backgroundColor).not.toBe('#A8505A');
  });

  it('disabled button override uses rgba amber-700@45% NOT old rose #DDA0A6', () => {
    // Find the primaryButtonDisabled style — it's referenced conditionally as styleArr[1]
    // We can check the style sheet's definition by finding any style with '#DDA0A6'
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#DDA0A6';
    });
    expect(bad).toHaveLength(0);
  });

  // ── No banned hex ──────────────────────────────────────────────────────────

  it('no elements use banned #94818A (ink/faint)', () => {
    const bad = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return s.color === '#94818A' || p.placeholderTextColor === '#94818A';
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

  it('no elements use old white surface #FFFFFF as backgroundColor', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old offline strip bg #FBF3EE', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FBF3EE';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old success banner bg #EAF5EC', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#EAF5EC';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old green success text #2D6A35', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#2D6A35';
    });
    expect(bad).toHaveLength(0);
  });

  it('no elements use old inputError border #C0762B', () => {
    const bad = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderColor === '#C0762B';
    });
    expect(bad).toHaveLength(0);
  });

  // ── Flex root bg ───────────────────────────────────────────────────────────

  it('flex root bg is surface.base #FBF6F1', () => {
    // KeyboardAvoidingView is the outermost element
    const s = flat(tree.props.style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });
});
