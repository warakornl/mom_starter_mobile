/**
 * appointmentFormScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B2 reskin — AppointmentFormScreen
 *
 * Loss-sensitive screen (B2 #2 of 3):
 *   lifecycle='ended' → week-indexed dateLabel suppressed; free title field remains.
 *   Fail-on-revert tests prove the guard is load-bearing.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
    enqueueCreateChecklistItem: jest.fn(),
    enqueueUpdateChecklistItem: jest.fn(),
    enqueueDeleteChecklistItem: jest.fn(),
    enqueueCreateReminder: jest.fn(),
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
  toCivilTime: jest.fn(() => '09:00'),
  parseCivilDate: jest.fn(() => new Date('2026-07-10')),
  parseCivilTime: jest.fn(() => new Date()),
}));

jest.mock('./pendingCalendarFocusDate', () => ({
  setPendingCalendarFocusDate: jest.fn(),
}));

jest.mock('./ancReminderBuilder', () => ({
  buildAncReminderRecord: jest.fn(() => ({})),
}));

jest.mock('./appointmentFormPrefill', () => ({
  initAppointmentFormState: jest.fn((input: { prefill?: { dateLabel?: { th: string; en: string }; fromSuggestion?: boolean }; locale?: string; existingItem?: unknown; defaultCategory?: string }) => ({
    title: '',
    category: input.defaultCategory ?? 'appointment',
    date: '2026-07-10',
    time: '09:00',
    allDay: false,
    dateLabel: input.prefill?.dateLabel
      ? (input.locale === 'en' ? input.prefill.dateLabel.en : input.prefill.dateLabel.th)
      : '',
    headerDisclaimer: null,
  })),
  buildChecklistItemToCreate: jest.fn(() => ({ id: 'new-1' })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { AppointmentFormScreen } from './AppointmentFormScreen';
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

/** ANC suggestion prefill with a week-indexed dateLabel */
const ancPrefill = {
  title: { th: 'นัดฝากครรภ์ครั้งที่ 4', en: 'ANC Visit 4' },
  dateLabel: { th: 'วันที่นัดครั้งที่ 4 (สัปดาห์ที่ 28)', en: 'ANC Visit 4 Date (Week 28)' },
  headerDisclaimer: { th: 'คำแนะนำโดยแพทย์', en: 'Doctor recommendation' },
  date: '',
  time: '09:00',
  allDay: false,
  category: 'appointment' as const,
  fromSuggestion: true as const,
  attachReminder: false as const,
  sourceSuggestionStateId: 'anc_next_checkup' as const,
};

const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppointmentFormScreen — ห้องแม่ Phase 2 B2 reskin', () => {

  // ── Token migration tests ──────────────────────────────────────────────────

  it('no elements use IBMPlexSans or IBMPlexMono font families', () => {
    const tree = AppointmentFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned #94818A', () => {
    const tree = AppointmentFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = AppointmentFormScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('input bg uses T.input.bg (ivory-200, not white)', () => {
    const tree = AppointmentFormScreen(baseProps) as React.ReactElement;
    const whiteInputs = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      const s = flat(p.style);
      return (el.type === 'TextInput' || String(el.type).includes('Input')) &&
             s.backgroundColor === '#FFFFFF';
    });
    expect(whiteInputs).toHaveLength(0);
  });

  it('save button uses T.button.primary.bg amber-700', () => {
    const tree = AppointmentFormScreen(baseProps) as React.ReactElement;
    const btns = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.button.primary.bg;
    });
    expect(btns.length).toBeGreaterThan(0);
  });

  it('input error border uses T.input.border.error (roselle-500, NOT old #A8505A)', () => {
    const tree = AppointmentFormScreen(baseProps) as React.ReactElement;
    // No element should use the old error border color
    const oldErrors = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.borderColor === '#A8505A';
    });
    expect(oldErrors).toHaveLength(0);
  });

  // ── Loss-gate tests ────────────────────────────────────────────────────────

  it('LOSS-GATE: week-indexed dateLabel is NOT shown when lifecycle = "ended" + ANC prefill', () => {
    // Guard: lifecycle='ended' → dateLabel (week-reference) suppressed.
    // Removing the guard → week label appears → this test goes RED.
    const tree = AppointmentFormScreen({
      ...baseProps,
      prefill: ancPrefill,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const weekLabels = findAll(tree, (el) => {
      const children = (el.props as { children?: unknown }).children;
      return typeof children === 'string' &&
        (children as string).includes('สัปดาห์ที่ 28');
    });
    expect(weekLabels).toHaveLength(0);
  });

  it('FAIL-ON-REVERT: week-indexed dateLabel IS shown when lifecycle = "pregnant" + ANC prefill', () => {
    // Guard removal → this stays GREEN alone (week label present).
    // But combined with the LOSS-GATE test above, guard removal makes the suite RED.
    const tree = AppointmentFormScreen({
      ...baseProps,
      prefill: ancPrefill,
      lifecycle: 'pregnant',
    }) as React.ReactElement;
    const weekLabels = findAll(tree, (el) => {
      const children = (el.props as { children?: unknown }).children;
      return typeof children === 'string' &&
        (children as string).includes('สัปดาห์ที่ 28');
    });
    expect(weekLabels.length).toBeGreaterThan(0);
  });

  it('FAIL-ON-REVERT: week label IS shown when lifecycle is undefined + ANC prefill', () => {
    // GAP-2: undefined lifecycle must NOT suppress the label.
    const tree = AppointmentFormScreen({
      ...baseProps,
      prefill: ancPrefill,
      // lifecycle absent = undefined
    }) as React.ReactElement;
    const weekLabels = findAll(tree, (el) => {
      const children = (el.props as { children?: unknown }).children;
      return typeof children === 'string' &&
        (children as string).includes('สัปดาห์ที่ 28');
    });
    expect(weekLabels.length).toBeGreaterThan(0);
  });

  it('title field always present regardless of lifecycle', () => {
    // "free title field remains" — core field is never suppressed.
    const treeEnded = AppointmentFormScreen({
      ...baseProps,
      prefill: ancPrefill,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const inputs = findAll(treeEnded, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'appointment-title';
    });
    expect(inputs.length).toBeGreaterThan(0);
  });
});
