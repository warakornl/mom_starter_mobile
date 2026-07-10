/**
 * birthEventScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — BirthEventScreen
 * No loss gate (BirthEventScreen is the writer of loss state).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', TextInput: 'TextInput',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() }, ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal', SafeAreaView: 'SafeAreaView', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./pregnancyApiClient', () => ({ createPregnancyClient: jest.fn(() => ({})) }));
jest.mock('./gestationalAge', () => ({ localCivilToday: jest.fn(() => '2026-07-10') }));
jest.mock('../i18n/messages', () => ({ formatCivilDate: jest.fn((d: string) => d) }));
jest.mock('./hospitalStayLogic', () => ({
  validateHospitalDates: jest.fn(() => ({ admissionError: null, dischargeError: null, warnAdmission: false })),
  shouldWarnAdmissionFarFromBirth: jest.fn(() => false),
  buildHospitalStayFields: jest.fn(() => []),
}));

import React from 'react';
import { BirthEventScreen } from './BirthEventScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  profileVersion: 1,
  onBirthRecorded: jest.fn(),
  onCancel: jest.fn(),
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

describe('BirthEventScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans or IBMPlexMono', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned ink-faint #94818A', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use banned ink-soft #5F4A52', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52';
    })).toHaveLength(0);
  });

  it('no elements use banned ink #3A2A30', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#3A2A30';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as surface bg', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use old rose-700 #8E3A44', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    })).toHaveLength(0);
  });

  it('no elements use placeholderTextColor #94818A in inline prop', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.placeholderTextColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use old disabled rose/300 #DDA0A6', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#DDA0A6';
    })).toHaveLength(0);
  });

  it('primary save button bg is T.button.primary.bg', () => {
    const tree = BirthEventScreen(baseProps) as React.ReactElement;
    const btns = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return String(p.testID).includes('birth-event-save');
    });
    if (btns.length > 0) {
      const styleArr = (btns[0].props as Record<string, unknown>).style as unknown[];
      const base = flat(Array.isArray(styleArr) ? styleArr[0] : styleArr);
      expect(base.backgroundColor).toBe(T.button.primary.bg);
    }
  });
});
