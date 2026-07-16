/**
 * reminderFormScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B2 reskin — ReminderFormScreen
 *
 * Loss-sensitive screen (B2 #3 of 3):
 *   lifecycle='ended' → milestone preset template chips hidden.
 *   Custom reminder creation remains fully available.
 *   Fail-on-revert proofs show guard is load-bearing.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg', Svg: 'Svg', Path: 'Path', Circle: 'Circle', Rect: 'Rect',
  Line: 'Line', G: 'G', Ellipse: 'Ellipse',
}));

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() }, Switch: 'Switch', Modal: 'Modal',
  Platform: { OS: 'ios' },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useRef: jest.fn((v: unknown) => ({ current: v })),
  };
});

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('../i18n/messages', () => ({
  formatCivilDate: jest.fn((d: string) => d),
}));

jest.mock('../sync/calendarSyncStore', () => ({
  calendarSyncStore: {
    getActiveReminders: jest.fn(() => []),
    getOccurrencesForReminder: jest.fn(() => []),
    enqueueCreateReminder: jest.fn(),
    enqueueUpdateReminder: jest.fn(),
    enqueueDeleteReminder: jest.fn(),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createCalendarSyncClient: jest.fn(() => ({})),
}));

jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(() => Promise.resolve({ ok: true })),
}));

jest.mock('../pregnancy/gestationalAge', () => ({
  localCivilToday: jest.fn(() => '2026-07-10'),
}));

jest.mock('./dateTimePickerFormat', () => ({
  toCivilDate: jest.fn((d: Date) => d.toISOString().slice(0, 10)),
  toCivilTime: jest.fn(() => '08:00'),
  parseCivilDate: jest.fn(() => new Date('2026-07-10')),
  parseCivilTime: jest.fn(() => new Date()),
}));

jest.mock('./pendingCalendarFocusDate', () => ({
  setPendingCalendarFocusDate: jest.fn(),
}));

jest.mock('../notifications', () => ({
  reanchor: jest.fn(() => Promise.resolve()),
}));

jest.mock('./reminderFormValidator', () => ({
  validateRecurrenceRule: jest.fn(() => []),
  WEEKDAY_TOKENS: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
  WEEKDAY_TOKEN_INDEX: { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { ReminderFormScreen } from './ReminderFormScreen';
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

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve(null)),
  save: jest.fn(),
  clear: jest.fn(),
};

const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReminderFormScreen — ห้องแม่ Phase 2 B2 reskin', () => {

  // ── Token migration tests ──────────────────────────────────────────────────

  it('no elements use IBMPlexSans or IBMPlexMono font families', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old teal/500 #3B8C8C', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#3B8C8C' || s.backgroundColor === '#3B8C8C';
    });
    expect(hits).toHaveLength(0);
  });

  it('save button uses T.button.primary.bg (amber-700)', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const btns = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.button.primary.bg;
    });
    expect(btns.length).toBeGreaterThan(0);
  });

  it('chip selected state uses T.color.surface.wash.roselle, not #A8505A', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const oldChipSelected = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#A8505A' && s.borderColor === '#A8505A';
    });
    expect(oldChipSelected).toHaveLength(0);
  });

  it('input bg uses T.input.bg (ivory-200, not white)', () => {
    const tree = ReminderFormScreen(baseProps) as React.ReactElement;
    const whiteInputs = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    });
    expect(whiteInputs).toHaveLength(0);
  });

  // ── Loss-gate tests (milestone preset templates) ───────────────────────────

  it('LOSS-GATE: milestone preset section (testID=reminder-milestone-presets) ABSENT when lifecycle = "ended"', () => {
    // Guard: lifecycle='ended' → presets hidden (week/countdown templates suppressed).
    // Removing the guard → section appears → this test goes RED.
    const tree = ReminderFormScreen({
      ...baseProps,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const presets = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'reminder-milestone-presets',
    );
    expect(presets).toHaveLength(0);
  });

  it('FAIL-ON-REVERT: milestone presets PRESENT when lifecycle = "pregnant"', () => {
    // Guard removal → section present → this stays GREEN alone.
    // But LOSS-GATE test above goes RED — guard is load-bearing.
    const tree = ReminderFormScreen({
      ...baseProps,
      lifecycle: 'pregnant',
    }) as React.ReactElement;
    const presets = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'reminder-milestone-presets',
    );
    expect(presets.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: milestone presets PRESENT when lifecycle is undefined (GAP-2)', () => {
    // undefined lifecycle = unknown context; must NOT suppress (not a loss state).
    const tree = ReminderFormScreen({
      ...baseProps,
      // lifecycle absent
    }) as React.ReactElement;
    const presets = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'reminder-milestone-presets',
    );
    expect(presets.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: milestone presets PRESENT when lifecycle = "postpartum"', () => {
    // postpartum is not a loss state.
    const tree = ReminderFormScreen({
      ...baseProps,
      lifecycle: 'postpartum',
    }) as React.ReactElement;
    const presets = findAll(tree, (el) =>
      (el.props as Record<string, unknown>).testID === 'reminder-milestone-presets',
    );
    expect(presets.length).toBeGreaterThan(0);
  });

  it('custom reminder title field always available regardless of lifecycle', () => {
    // "Custom reminders can still be created freely" — title field must always be present.
    const treeEnded = ReminderFormScreen({
      ...baseProps,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const titleFields = findAll(treeEnded, (el) =>
      (el.props as Record<string, unknown>).testID === 'reminder-title',
    );
    expect(titleFields.length).toBeGreaterThan(0);
  });
});
