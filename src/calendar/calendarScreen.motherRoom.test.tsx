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

jest.mock('../autoStockDecrement/feedingSessionStore', () => ({
  feedingSessionStore: { getAll: jest.fn(() => []) },
}));

jest.mock('./feedingAgenda', () => ({
  getFeedingSessionsForDate: jest.fn(() => []),
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

  // ── Day-dot missed/due distinction (🔴 review fix) ─────────────────────────
  // Bug: dotRose (missed) and dotTeal (due) both resolved to
  // T.color.list.bar.pregnancy, making missed (top precedence, "urgent")
  // visually IDENTICAL to due on the 6dp day-grid dot, with color as the only
  // cue. Fix: missed → T.color.state.attention + a ring (non-color cue).
  describe('day-grid missed/due dot distinction', () => {
    const { calendarSyncStore } = jest.requireMock('../sync/calendarSyncStore') as {
      calendarSyncStore: {
        getActiveChecklistItems: jest.Mock;
        getActiveReminders: jest.Mock;
        getOccurrencesForReminder: jest.Mock;
      };
    };
    const { expand } = jest.requireMock('../recurrence/recurrenceExpander') as {
      expand: jest.Mock;
    };

    afterEach(() => {
      calendarSyncStore.getActiveChecklistItems.mockReturnValue([]);
      calendarSyncStore.getActiveReminders.mockReturnValue([]);
      calendarSyncStore.getOccurrencesForReminder.mockReturnValue([]);
      expand.mockReturnValue([]);
    });

    it('FAIL-ON-REVERT: missed dot does NOT use the same token as due (T.color.list.bar.pregnancy)', () => {
      // One reminder projects to a single PAST civil day EARLIER IN THE SAME
      // MONTH (day 1, when today is not day 1 — guaranteed to stay within the
      // rendered displayMonth grid, unlike a plain "yesterday" which can cross
      // a month boundary) with no materialized row → buildProjectedItems
      // derives status='missed'.
      const today = new Date();
      // Guard: this construction requires today's day-of-month > 1 so day 1
      // is strictly in the past within the same displayed month.
      expect(today.getDate()).toBeGreaterThan(1);
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const pastCivil = `${y}-${m}-01T09:00`;

      calendarSyncStore.getActiveReminders.mockReturnValue([
        {
          id: 'rem-missed',
          type: 'custom',
          recurrenceRule: { freq: 'one_off' },
          startAt: pastCivil,
          sourceRefId: undefined,
        },
      ]);
      expand.mockReturnValue([pastCivil]);

      const tree = CalendarScreen(baseProps) as React.ReactElement;

      // Locate the day-grid dot via its dedicated testID (calendar-day-dot-missed
      // — set only when dayDotColor() === 'rose'/missed).
      const missedDots = findAll(tree, (el) => {
        return (el.props as Record<string, unknown>).testID === 'calendar-day-dot-missed';
      });
      expect(missedDots.length).toBeGreaterThan(0);
      const missedStyle = flat((missedDots[0].props as Record<string, unknown>).style);

      // Bug: missed previously resolved to T.color.list.bar.pregnancy — the
      // SAME token as the due dot — making them visually identical.
      expect(missedStyle.backgroundColor).not.toBe(T.color.list.bar.pregnancy);
      // Fix: missed uses T.color.state.attention as a distinct token...
      expect(missedStyle.backgroundColor).toBe(T.color.state.attention);
      // ...AND a non-color ring cue (shape as primary cue — WCAG SC 1.4.1),
      // so the distinction does not rely on color alone.
      expect(missedStyle.borderWidth).toBeGreaterThan(0);
      expect(missedStyle.borderColor).toBe(T.color.state.attention);
    });

    // ── Mark-done Alert body — locale-aware date, not the raw ISO string ────
    // Bug: Alert.alert's body was the RAW ISO string
    // ("2026-07-15T08:00") verbatim. Fix: formatOccurrenceDateTime() builds a
    // "<formatCivilDate output> · HH:mm" string instead.
    it('FAIL-ON-REVERT: mark-done Alert body is NOT the raw scheduledLocalTime ISO string', () => {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const todayCivil = `${y}-${m}-${d}T08:00`;

      calendarSyncStore.getActiveReminders.mockReturnValue([
        {
          id: 'rem-due',
          type: 'custom',
          recurrenceRule: { freq: 'one_off' },
          startAt: todayCivil,
          sourceRefId: undefined,
        },
      ]);
      expand.mockReturnValue([todayCivil]);

      const tree = CalendarScreen(baseProps) as React.ReactElement;
      const agendaItems = findAll(
        tree,
        (el) => (el.props as Record<string, unknown>).testID === 'calendar-agenda-item',
      );
      expect(agendaItems.length).toBeGreaterThan(0);

      const onPress = (agendaItems[0].props as { onPress?: () => void }).onPress;
      expect(typeof onPress).toBe('function');
      onPress!();

      const { Alert } = jest.requireMock('react-native') as { Alert: { alert: jest.Mock } };
      expect(Alert.alert).toHaveBeenCalled();
      const [, body] = Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1];
      // Raw ISO string uses "T" as the date/time separator with no spacing —
      // the fix's format uses " · " between the (mocked passthrough)
      // formatCivilDate output and the "HH:mm" time.
      expect(body).not.toBe(todayCivil);
      expect(body).toContain(' · ');
      expect(body).toContain('08:00');
    });
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

// ─── kickCountItems session-row loss gate (BLOCKER B) ─────────────────────────
//
// CalendarScreen.tsx rendered kick-count SESSION rows bypass filterLossStateItems
// (they come from kickCountSyncStore.getActiveSessions(), not from reminder occurrences).
// The fix gates the kickCountItems useMemo itself: lifecycle==='ended' → returns [].
//
// These tests render CalendarScreen with a mocked getKickCountSessionsForDate that
// returns a non-empty session and assert the session is ABSENT when lifecycle='ended'
// and PRESENT when 'pregnant'/undefined — proving the useMemo gate is load-bearing.

const { getKickCountSessionsForDate } = jest.requireMock('./kickCountAgenda') as {
  getKickCountSessionsForDate: jest.Mock;
};

const fakeSession = {
  id: 'ks-1',
  movementCount: 10,
  timeLabel: '09:00–09:30',
};

describe('CalendarScreen — kickCountItems session-row loss gate (B2 BLOCKER B)', () => {
  beforeEach(() => {
    // Make getKickCountSessionsForDate return a real session so we can assert its absence.
    getKickCountSessionsForDate.mockReturnValue([fakeSession]);
  });

  afterEach(() => {
    getKickCountSessionsForDate.mockReturnValue([]);
  });

  it('LOSS-GATE: kick-count session row is ABSENT when lifecycle = "ended"', () => {
    const tree = CalendarScreen({
      ...baseProps,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const kickRows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-kickcount-item';
    });
    // When lifecycle='ended' kickCountItems must be [] — no session rows rendered.
    expect(kickRows).toHaveLength(0);
  });

  it('FAIL-ON-REVERT: kick-count session row IS present when lifecycle = "pregnant"', () => {
    // Removing the gate makes kickCountItems always return sessions →
    // LOSS-GATE above goes RED; this test stays GREEN — proving the gate is load-bearing.
    const tree = CalendarScreen({
      ...baseProps,
      lifecycle: 'pregnant',
    }) as React.ReactElement;
    const kickRows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-kickcount-item';
    });
    expect(kickRows.length).toBeGreaterThan(0);
  });

  it('GAP-2: kick-count session row IS present when lifecycle = undefined', () => {
    // undefined lifecycle must NOT suppress (not a loss state per GAP-2).
    const tree = CalendarScreen({
      ...baseProps,
      // lifecycle absent = undefined
    }) as React.ReactElement;
    const kickRows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-kickcount-item';
    });
    expect(kickRows.length).toBeGreaterThan(0);
  });
});

// ─── feedingItems agenda row (bug fix — "บันทึกการให้นมไม่ขึ้นในปฏิทิน") ────────
//
// ROOT CAUSE: feedingSessionStore was never read by CalendarScreen at all —
// no CalendarItem kind, no agenda row rendering. Fixed by wiring
// feedingSessionStore.getAll() through getFeedingSessionsForDate into a new
// feedingItems useMemo (mirrors kickCountItems exactly, including the
// lifecycle='ended' loss-state suppression).
//
// These tests render CalendarScreen with a mocked getFeedingSessionsForDate
// that returns a non-empty session and assert:
//   - the row IS rendered (proves the wiring is real, not just present in code)
//   - the row is ABSENT when lifecycle='ended' (loss-state parity with kick-count)
//   - the row is PRESENT when lifecycle='pregnant'/undefined

const { getFeedingSessionsForDate } = jest.requireMock('./feedingAgenda') as {
  getFeedingSessionsForDate: jest.Mock;
};

const fakeFeedingSession = {
  id: 'fs-1',
  timeLabel: '10:00',
  kind: 'breastfeed' as const,
};

describe('CalendarScreen — bug fix: feeding sessions appear in the agenda', () => {
  beforeEach(() => {
    getFeedingSessionsForDate.mockReturnValue([fakeFeedingSession]);
  });

  afterEach(() => {
    getFeedingSessionsForDate.mockReturnValue([]);
  });

  it('FAIL-ON-REVERT: renders a calendar-feeding-item row when a feeding session exists on the selected day', () => {
    const tree = CalendarScreen({
      ...baseProps,
      lifecycle: 'pregnant',
    }) as React.ReactElement;
    const feedingRows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-feeding-item';
    });
    expect(feedingRows.length).toBeGreaterThan(0);
  });

  it('LOSS-GATE: feeding-session row is ABSENT when lifecycle = "ended"', () => {
    const tree = CalendarScreen({
      ...baseProps,
      lifecycle: 'ended',
    }) as React.ReactElement;
    const feedingRows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-feeding-item';
    });
    expect(feedingRows).toHaveLength(0);
  });

  it('GAP-2: feeding-session row IS present when lifecycle = undefined', () => {
    const tree = CalendarScreen({
      ...baseProps,
    }) as React.ReactElement;
    const feedingRows = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-feeding-item';
    });
    expect(feedingRows.length).toBeGreaterThan(0);
  });

  it('never renders amountSubUnits/volumeMl/durationSeconds text (K-8) — only the neutral kind label + time', () => {
    const tree = CalendarScreen({
      ...baseProps,
      lifecycle: 'pregnant',
    }) as React.ReactElement;
    const feedingRow = findAll(tree, (el) => {
      const p = el.props as Record<string, unknown>;
      return p.testID === 'calendar-feeding-item';
    })[0];
    expect(feedingRow).toBeDefined();
    // accessibilityLabel must be the resolved i18n key only (mocked t() is identity).
    const label = (feedingRow.props as Record<string, unknown>).accessibilityLabel;
    expect(label).toBe('calendar.feeding.breastfeed');
  });
});
