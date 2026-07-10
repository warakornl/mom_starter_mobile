/**
 * consentNudgeModal.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — ConsentNudgeModal
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

import React from 'react';
import { ConsentNudgeModal } from './ConsentNudgeModal';
import { T } from '../theme/tokens';

const baseProps = {
  visible: true,
  isLoading: false,
  onGrant: jest.fn(),
  onNotNow: jest.fn(),
  title: 'ขอความยินยอม',
  body: 'แอปนี้ต้องการเข้าถึงข้อมูลสุขภาพของคุณ',
  grantLabel: 'อนุญาต',
  notNowLabel: 'ไม่ใช่ตอนนี้',
  changeLaterNote: 'คุณสามารถเปลี่ยนแปลงได้ในภายหลัง',
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

describe('ConsentNudgeModal — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#A8505A' || s.color === '#A8505A';
    })).toHaveLength(0);
  });

  it('no elements use old rose/700 #8E3A44', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as sheet bg', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old DDA0A6 disabled rose', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#DDA0A6';
    })).toHaveLength(0);
  });

  it('grant button bg is T.button.primary.bg amber-700', () => {
    const tree = ConsentNudgeModal(baseProps) as React.ReactElement;
    if (tree == null) return;
    const grantBtns = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.button.primary.bg;
    });
    expect(grantBtns.length).toBeGreaterThan(0);
  });
});
