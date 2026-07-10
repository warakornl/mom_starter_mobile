/**
 * calendarScreen.motherRoom.test.tsx
 *
 * TDD: ห้องแม่ Phase 2 B2 reskin — CalendarScreen
 *
 * Loss-sensitive screen (B2 #1 of 3):
 *   lifecycle='ended' → kick_count occurrences filtered from day-dot calculation.
 *   Fail-on-revert proofs show guard is load-bearing.
 *
 * Token assertions walk the rendered tree (StyleSheet.create returns raw obj).
 * Loss-gate assertions test the exported pure fn `filterLossStateItems`.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', SafeAreaView: 'SafeAreaView',
  Modal: 'Modal', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((f: () => unknown) => f()),
    useEffect: jest.fn(),
    useRef: jest.fn((v: unknown) => ({ current: v })),
  };
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('../i18n/messages', () => ({
  formatCivilDate: jest.fn((d: string) => d),
  formatYearMonth: jest.fn((ym: string) => ym),
  interpolate: jest.fn((tmpl: string) => tmpl),
  WEEKDAYS: {
    th: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
    en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  },
}));

jest.mock('../kickCount/kickCountSyncStore', () => ({
  kickCountSyncStore: { getActiveSessions: jest.fn(() => []) },
}));

jest.mock('./kickCountAgenda', () => ({
  getKickCountSessionsForDate: jest.fn(() => []),
}));

jest.mock('../sync/calendarSyncStore', () => ({
  calendarSyncStore: {
    getActiveReminders: jest.fn(() => []),
    getActiveChecklistItems: jest.fn(() => []),
    getOccurrencesForReminder: jest.fn(() => []),
    getPendingCount: jest.fn(() => 0),
    getWatermark: jest.fn(() => null),
    enqueueOccurrence: jest.fn(),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createCalendarSyncClient: jest.fn(() => ({
    pull: jest.fn(() => Promise.resolve({ ok: true })),
  })),
}));

jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(() => Promise.resolve({ ok: true })),
}));

jest.mock('../recurrence/recurrenceExpander', () => ({
  expand: jest.fn(() => []),
}));

jest.mock('../occurrence/occurrenceId', () => ({
  computeOccurrenceId: jest.fn(() => 'mock-occ-id'),
}));

jest.mock('./civilDayBucketer', () => ({
  bucketCivilDay: jest.fn((s: string) => s.slice(0, 10)),
}));

jest.mock('./pendingCalendarFocusDate', () => ({
  consumePendingCalendarFocusDate: jest.fn(() => null),
}));

jest.mock('../notifications', () => ({
  reanchor: jest.fn(() => Promise.resolve()),
  cancelForOccurrence: jest.fn(() => Promise.resolve()),
  scheduleSnooze: jest.fn(() => Promise.resolve()),
  MEDICATION_TITLE_TH: 'ยา',
}));

jest.mock('../medication/medicationPlanSyncStore', () => ({
  medicationPlanSyncStore: { getPlans: jest.fn(() => []) },
}));

jest.mock('./medicationOccurrenceResolver', () => ({
  resolveMedicationOccurrenceTitle: jest.fn(() => ({ title: 'mock-title', dose: null })),
}));

jest.mock('../medication/medicationLogSyncStore', () => ({
  medicationLogSyncStore: { addLog: jest.fn() },
}));

jest.mock('../consent/consentStore', () => ({
  consentStore: { isGranted: jest.fn(() => true), setGranted: jest.fn() },
}));

jest.mock('../consent/consentApiClient', () => ({
  createConsentApiClient: jest.fn(() => ({ postConsent: jest.fn() })),
}));

jest.mock('../consent/consentSync', () => ({
  consentQueue: {
    hasPendingEntry: jest.fn(() => false),
    enqueue: jest.fn(),
    persist: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../consent/ConsentNudgeModal', () => ({
  ConsentNudgeModal: 'ConsentNudgeModal',
}));

jest.mock('./SnoozeChooserSheet', () => ({
  SnoozeChooserSheet: 'SnoozeChooserSheet',
}));

jest.mock('./snoozeChooserLogic', () => ({
  isMedicationReminder: jest.fn(() => false),
  computeSnoozedUntil: jest.fn(() => new Date()),
}));

jest.mock('react-native-svg', () => ({
  Svg: 'Svg', Path: 'Path',
}));

jest.mock('../illustrations/PandanEmptyState', () => ({
  PandanEmptyState: 'PandanEmptyState',
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { CalendarScreen, filterLossStateItems } from './CalendarScreen';
import type { CalendarItem } from './CalendarScreen';
import type { ReminderType } from '../sync/syncTypes';
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

// ─── Fixture CalendarItems for loss-gate tests ────────────────────────────────

function makeOccurrenceItem(reminderType: ReminderType): CalendarItem {
  return {
    kind: 'occurrence',
    id: 'oc-1',
    reminderId: 'r-1',
    scheduledLocalTime: '2026-07-10T09:00',
    displayTitle: 'test',
    dose: null,
    status: 'due',
    materialized: false,
    reminderType,
    sourceRefId: undefined,
  };
}

function makeChecklistItem(): CalendarItem {
  return {
    kind: 'checklist',
    item: {
      id: 'cl-1',
      category: 'appointment',
      title: 'นัดแพทย์',
      scheduledAt: '2026-07-10T09:00',
      done: false,
      note: null,
      source: 'user_created',
      version: 1,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CalendarScreen — ห้องแม่ Phase 2 B2 reskin', () => {

  // ── Token migration tests (tree-walk) ──────────────────────────────────────

  it('no elements use IBMPlexSans or IBMPlexMono font families', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' &&
        ((s.fontFamily as string).includes('IBMPlex') || (s.fontFamily as string).includes('Looped'));
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use banned ink/faint #94818A', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old teal/500 #3B8C8C', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#3B8C8C' || s.color === '#3B8C8C';
    });
    expect(hits).toHaveLength(0);
  });

  it('no elements use old sage/600 #4A7A56', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const hits = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#4A7A56' || s.color === '#4A7A56';
    });
    expect(hits).toHaveLength(0);
  });

  it('container uses T.color.surface.base as background', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const containers = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.surface.base;
    });
    expect(containers.length).toBeGreaterThan(0);
  });

  it('agenda add buttons use T.color.accent.interactive (amber-700) background', () => {
    const tree = CalendarScreen(baseProps) as React.ReactElement;
    const ctaBtns = findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === T.color.accent.interactive;
    });
    expect(ctaBtns.length).toBeGreaterThan(0);
  });

  // ── filterLossStateItems — pure-function loss gate tests ───────────────────

  it('LOSS-GATE: kick_count occurrence is filtered when lifecycle = "ended"', () => {
    const item = makeOccurrenceItem('kick_count');
    const result = filterLossStateItems([item], 'ended');
    expect(result).toHaveLength(0);
  });

  it('FAIL-ON-REVERT: kick_count occurrence retained when lifecycle = "pregnant"', () => {
    // Removing the guard makes filterLossStateItems return all items → this stays GREEN.
    // But the LOSS-GATE test above goes RED — proving the guard is load-bearing.
    const item = makeOccurrenceItem('kick_count');
    const result = filterLossStateItems([item], 'pregnant');
    expect(result).toHaveLength(1);
  });

  it('GAP-2: undefined lifecycle does NOT suppress kick_count occurrence', () => {
    // A null/unknown snapshot must NEVER default a real loss to pregnant.
    // Conversely, undefined lifecycle must never suppress items (not a loss state).
    const item = makeOccurrenceItem('kick_count');
    const result = filterLossStateItems([item], undefined);
    expect(result).toHaveLength(1);
  });

  it('FAIL-ON-REVERT: appointment (checklist) items retained in loss state', () => {
    // ANC appointment rows are retained in loss state (spec §3 CalendarScreen).
    const clItem = makeChecklistItem();
    const result = filterLossStateItems([clItem], 'ended');
    expect(result).toHaveLength(1);
  });

  it('non-pregnancy occurrence types retained in loss state', () => {
    // 'medication', 'feeding', 'supply_restock', 'custom' are not suppressed.
    const medItem = makeOccurrenceItem('medication');
    expect(filterLossStateItems([medItem], 'ended')).toHaveLength(1);

    const feedItem = makeOccurrenceItem('feeding');
    expect(filterLossStateItems([feedItem], 'ended')).toHaveLength(1);

    const customItem = makeOccurrenceItem('custom');
    expect(filterLossStateItems([customItem], 'ended')).toHaveLength(1);
  });

  it('mixed array: only kick_count suppressed in loss state', () => {
    const items = [
      makeChecklistItem(),
      makeOccurrenceItem('kick_count'),
      makeOccurrenceItem('medication'),
    ];
    const result = filterLossStateItems(items, 'ended');
    expect(result).toHaveLength(2);
    expect(result.some((i) => i.kind === 'occurrence' && i.reminderType === 'kick_count')).toBe(false);
  });

  it('postpartum lifecycle does NOT suppress kick_count occurrence', () => {
    // postpartum is not a loss state — kick count may have historical data.
    const item = makeOccurrenceItem('kick_count');
    const result = filterLossStateItems([item], 'postpartum');
    expect(result).toHaveLength(1);
  });
});
