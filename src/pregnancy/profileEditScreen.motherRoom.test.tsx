/**
 * profileEditScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — ProfileEditScreen
 *
 * Loss wiring from B1 is preserved; this test covers token migration only.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useEffect: jest.fn(),
    useCallback: jest.fn((fn: unknown) => fn),
    useRef: jest.fn(() => ({ current: false })),
  };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./profileEditRuntimeWiring', () => ({
  runEditGet: jest.fn(), runSave: jest.fn(),
}));
jest.mock('./gestationalAge', () => ({
  localCivilToday: jest.fn(() => '2026-07-10'),
  computeGestationalAge: jest.fn(() => ({
    currentStage: 'T2', displayedWeek: 20, gestationalDay: 3,
    suppressDayDisplay: false, deliveryWindowActive: false,
  })),
}));
jest.mock('../i18n/messages', () => ({ formatCivilDate: jest.fn((d: string) => d) }));
jest.mock('./profileEditLogic', () => ({
  resolveEditGetOutcome: jest.fn(() => ({ action: 'show_form', profile: null })),
  resolveEditSaveOutcome: jest.fn(() => ({ action: 'saved' })),
  validateEdd: jest.fn(() => ({ valid: true, error: null })),
}));
jest.mock('./ProfileSetupScreen', () => ({ ProfileSetupScreen: () => null }));

import React from 'react';
import { ProfileEditScreen } from './ProfileEditScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const mockNavigation = { addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), goBack: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  navigation: mockNavigation as never,
  onEditComplete: jest.fn(),
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

describe('ProfileEditScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans', () => {
    const tree = ProfileEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned #5F4A52 or #3A2A30', () => {
    const tree = ProfileEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52' || s.color === '#3A2A30';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = ProfileEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as bg', () => {
    const tree = ProfileEditScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('container bg is T.color.surface.base', () => {
    const tree = ProfileEditScreen(baseProps) as React.ReactElement;
    const s = flat((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });
});
