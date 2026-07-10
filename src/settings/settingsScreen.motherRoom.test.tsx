/**
 * settingsScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — SettingsScreen
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th', setLocale: jest.fn() }),
}));

import React from 'react';
import { SettingsScreen } from './SettingsScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = { tokenStorage: mockTokenStorage, onLogout: jest.fn() };

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

describe('SettingsScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned ink-faint #94818A', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use banned ink-soft #5F4A52', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52';
    })).toHaveLength(0);
  });

  it('no elements use banned ink #3A2A30', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#3A2A30';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF for bg (nested surfaces)', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('container bg is T.color.surface.base', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    const s = flat((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });

  it('sectionLabel color is T.color.text.botanical', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    const labels = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === T.color.text.botanical;
    });
    expect(labels.length).toBeGreaterThan(0);
  });

  it('menu rows use T.color.surface.subtle not white', () => {
    const tree = SettingsScreen(baseProps) as React.ReactElement;
    const rows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'settings-language-btn';
    });
    expect(rows.length).toBeGreaterThan(0);
    const s = flat((rows[0].props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.subtle);
  });
});
