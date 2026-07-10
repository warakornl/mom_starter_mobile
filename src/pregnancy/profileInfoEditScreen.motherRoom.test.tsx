/**
 * profileInfoEditScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — ProfileInfoEditScreen
 *
 * Key: validation border #EF4444 → T.input.border.error (roselle-500)
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', TextInput: 'TextInput',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]), useCallback: jest.fn((fn: unknown) => fn), useEffect: jest.fn(), useRef: jest.fn(() => ({ current: null })) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./profileInfoEditRuntimeWiring', () => ({
  runInfoEntryGet: jest.fn(), runInfoSave: jest.fn(),
}));
jest.mock('./profileInfoEditLogic', () => ({
  validateNameInput: jest.fn(() => ({ valid: true, error: null })),
}));

import React from 'react';
import { ProfileInfoEditScreen } from './ProfileInfoEditScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  onSaveComplete: jest.fn(),
  onSessionExpired: jest.fn(),
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

describe('ProfileInfoEditScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans', () => {
    const tree = ProfileInfoEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned clinical-red #EF4444', () => {
    const tree = ProfileInfoEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#EF4444' || s.backgroundColor === '#EF4444' || s.borderColor === '#EF4444';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = ProfileInfoEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as bg', () => {
    const tree = ProfileInfoEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old ROSE disabled #DDA0A6', () => {
    const tree = ProfileInfoEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#DDA0A6';
    })).toHaveLength(0);
  });

  it('save button bg is T.button.primary.bg amber-700', () => {
    const tree = ProfileInfoEditScreen(baseProps) as React.ReactElement;
    const btns = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'profile-info-edit-save-btn';
    });
    if (btns.length > 0) {
      const styleArr = (btns[0].props as Record<string, unknown>).style as unknown[];
      const base = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
      expect(base.backgroundColor).toBe(T.button.primary.bg);
    }
  });
});
