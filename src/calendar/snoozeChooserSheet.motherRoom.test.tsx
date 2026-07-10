/**
 * snoozeChooserSheet.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B2 reskin — SnoozeChooserSheet
 *
 * No loss gate (sheet is medication-only UX element, not pregnancy-progress content).
 * Tests: token migration only.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  Pressable: 'Pressable', Modal: 'Modal', ScrollView: 'ScrollView',
  StyleSheet: { create: (o: unknown) => o },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r };
});

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('../i18n/messages', () => ({
  interpolate: jest.fn((tmpl: string) => tmpl),
}));

jest.mock('./snoozeChooserLogic', () => ({
  getSnoozeOptions: jest.fn(() => [
    { minutes: 10, alertsAtStr: '09:10' },
    { minutes: 30, alertsAtStr: '09:30' },
    { minutes: 60, alertsAtStr: '10:00' },
  ]),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { SnoozeChooserSheet } from './SnoozeChooserSheet';
import { T } from '../theme/tokens';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

const baseProps = {
  visible: true,
  now: new Date('2026-07-10T09:00:00'),
  onPick: jest.fn(),
  onDismiss: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SnoozeChooserSheet — ห้องแม่ Phase 2 B2 reskin', () => {

  it('no elements use IBMPlexSans or IBMPlexMono (including Looped-SemiBold → Sarabun)', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' &&
        ((s.fontFamily as string).includes('IBMPlex') || (s.fontFamily as string).includes('Looped'));
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned ink/faint #94818A', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old ink #3A2A30', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#3A2A30' || s.backgroundColor === '#3A2A30';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old rose/700 #8E3A44 as cancel label color', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use white #FFFFFF as sheet background', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    });
    expect(hits).toHaveLength(0);
  });

  it('sheet body uses T.color.surface.base background', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.base;
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('sheet uses radius.lg (20dp) for top corners', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderTopLeftRadius === T.radius.lg || s.borderTopRightRadius === T.radius.lg;
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('drag handle uses T.color.surface.subtle background', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const handles = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.width === 36 && s.height === 4 && s.backgroundColor === T.color.surface.subtle;
    });
    expect(handles.length).toBeGreaterThan(0);
  });

  it('title uses T.color.text.heading (roselle-900)', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const titles = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return p.testID === 'snooze-chooser-title' && s.color === T.color.text.heading;
    });
    expect(titles.length).toBeGreaterThan(0);
  });

  it('option rows use T.color.text.primary for body text', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    // optionLabel texts should use T.color.text.primary
    const optionLabels = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === T.color.text.primary && typeof s.fontFamily === 'string' &&
        (s.fontFamily as string).includes('Sarabun');
    });
    expect(optionLabels.length).toBeGreaterThan(0);
  });

  it('cancel label uses T.color.text.primary (NOT old rose/700 #8E3A44)', () => {
    const tree = SnoozeChooserSheet(baseProps) as React.ReactElement;
    const cancelRow = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'snooze-chooser-cancel',
    );
    expect(cancelRow.length).toBeGreaterThan(0);
    if (cancelRow.length > 0) {
      const labelChildren = findAll(cancelRow[0], (el) => {
        const s = flat((el.props as Record<string, unknown>).style);
        return s.color === T.color.text.primary;
      });
      expect(labelChildren.length).toBeGreaterThan(0);
    }
  });
});
