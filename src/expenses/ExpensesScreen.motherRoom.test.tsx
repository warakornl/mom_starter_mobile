/**
 * ExpensesScreen.motherRoom.test.tsx — TDD RED → GREEN
 *
 * UX/UI review fixes (Cluster 5):
 *   - Row date + form-echo date now use formatCivilDate (พ.ศ. in th) instead
 *     of echoing the raw "YYYY-MM-DD" ISO string.
 *   - Month-nav accessibilityLabels are no longer hardcoded English literals.
 *   - The "jump to current month" pill copy is no longer hardcoded bilingual
 *     "⬤ เดือนนี้ / This month".
 *   - Error banner now has a VISIBLE retry affordance (role="button" + label +
 *     visible retry text), not just an invisible tappable area.
 *
 * Convention: components called as plain functions (no @testing-library/react-native
 * in this repo) — mirrors AutoDecrementSettingsScreen.motherRoom.test.tsx.
 *
 * Security: synthetic expense data only — no real financial/health values.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, jest.fn()]),
    useRef: jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useEffect: jest.fn(),
  };
});

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg', Svg: 'Svg', Path: 'Path', Circle: 'Circle', Rect: 'Rect',
  Line: 'Line', G: 'G', Ellipse: 'Ellipse',
}));

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (o: unknown) => o },
  SafeAreaView: 'SafeAreaView',
  FlatList: 'FlatList',
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: 'DateTimePicker',
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: (k: string) => k,
    locale: 'th',
  })),
}));

jest.mock('./expensesSyncStore', () => ({
  expensesSyncStore: {
    getExpenses: jest.fn(() => []),
    getExpense: jest.fn(() => undefined),
    getWatermark: jest.fn(() => undefined),
    getPendingCount: jest.fn(() => 0),
    enqueueCreate: jest.fn(),
    enqueueUpdate: jest.fn(),
    enqueueDelete: jest.fn(),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createExpensesSyncClient: jest.fn(() => ({
    push: jest.fn(() => Promise.resolve({ ok: true, applied: [], conflicts: [], rejected: [] })),
    pull: jest.fn(() => Promise.resolve({ ok: true, watermark: '' })),
  })),
}));

jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(() => Promise.resolve({ ok: true, conflicts: [], rejected: [] })),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { ExpensesScreen } from './ExpensesScreen';
import { expensesSyncStore } from './expensesSyncStore';
import { formatCivilDate } from '../i18n/messages';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// FlatList's data.length in production determines whether ListEmptyComponent
// or renderItem shows — this walker respects that (only walks ListEmptyComponent
// when data is empty/absent, only walks renderItem output when data is non-empty).
// Nested function-component elements (e.g. <ExpenseRow .../>) are themselves
// unexecuted JSX — invoke them as plain functions to reach their real output,
// same convention as SuppliesScreen.motherRoom.test.tsx.
function walkAll(
  n: unknown,
  visitEl: (el: React.ReactElement) => void,
  visitText: (t: string) => void,
): void {
  if (n == null || n === false || n === true) return;
  if (typeof n === 'string') { visitText(n); return; }
  if (typeof n === 'number') { visitText(String(n)); return; }
  if (Array.isArray(n)) { (n as unknown[]).forEach((c) => walkAll(c, visitEl, visitText)); return; }
  if (!React.isValidElement(n)) return;
  const el = n as React.ReactElement;
  visitEl(el);

  // Execute nested function-component elements (not host elements like 'View'/'Text').
  if (typeof el.type === 'function') {
    const Comp = el.type as (p: unknown) => unknown;
    walkAll(Comp(el.props), visitEl, visitText);
    return;
  }

  walkAll((el.props as { children?: unknown }).children, visitEl, visitText);
  const props = el.props as Record<string, unknown>;
  if (props.ListHeaderComponent) walkAll(props.ListHeaderComponent, visitEl, visitText);
  const data = props.data as unknown[] | undefined;
  if (props.renderItem && data && data.length > 0) {
    data.forEach((item, index) => {
      const rendered = (props.renderItem as (info: { item: unknown; index: number }) => unknown)({ item, index });
      walkAll(rendered, visitEl, visitText);
    });
  } else if (props.ListEmptyComponent) {
    walkAll(props.ListEmptyComponent, visitEl, visitText);
  }
}

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  walkAll(node, (el) => { if (pred(el)) acc.push(el); }, () => {});
  return acc;
}

function collectText(node: unknown): string[] {
  const texts: string[] = [];
  walkAll(node, () => {}, (t) => texts.push(t));
  return texts;
}

const baseProps = {
  tokenStorage: {
    load: jest.fn(() => Promise.resolve(null)),
    save: jest.fn(),
    clear: jest.fn(),
  },
  apiBaseUrl: 'https://api.example.com',
};

const EXPENSE_ITEM = {
  id: 'expense-1',
  amount: 12000, // 120.00 baht
  category: 'baby-supplies' as const,
  incurredOn: '2026-07-11',
  note: null,
  clientId: 'client-1',
  version: 1,
  createdAt: '2026-07-11T00:00:00Z',
  updatedAt: '2026-07-11T00:00:00Z',
  deletedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (expensesSyncStore.getExpenses as jest.Mock).mockReturnValue([]);
});

describe('ExpensesScreen — review fix: row date is formatted (พ.ศ.), not raw ISO', () => {
  it('the expense row shows the formatCivilDate output, not the raw "YYYY-MM-DD" string', () => {
    (expensesSyncStore.getExpenses as jest.Mock).mockReturnValue([EXPENSE_ITEM]);
    const tree = ExpensesScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    const formatted = formatCivilDate(EXPENSE_ITEM.incurredOn, 'th');
    expect(texts).toContain(formatted);
    expect(texts).not.toContain(EXPENSE_ITEM.incurredOn);
  });
});

describe('ExpensesScreen — review fix: month-nav accessibilityLabels are not hardcoded English', () => {
  it('previous/next month buttons do NOT use the literal English "Previous month"/"Next month"', () => {
    const tree = ExpensesScreen(baseProps) as React.ReactElement;
    const buttons = findAll(tree, (el) => (el.props as Record<string, unknown>).accessibilityRole === 'button');
    const labels = buttons.map((b) => (b.props as Record<string, unknown>).accessibilityLabel);
    expect(labels).not.toContain('Previous month');
    expect(labels).not.toContain('Next month');
  });

  it('previous/next month nav buttons carry a non-empty accessibilityLabel', () => {
    const tree = ExpensesScreen(baseProps) as React.ReactElement;
    const monthNavBtns = findAll(tree, (el) => {
      const props = el.props as Record<string, unknown>;
      return (
        props.accessibilityRole === 'button' &&
        typeof props.hitSlop === 'object' &&
        // Distinguish month-nav chevrons from other buttons by their
        // accessibilityLabel matching the real i18n catalog keys
        // (t() is mocked to echo the key in this suite).
        (props.accessibilityLabel === 'expenses.monthNavPrevA11y' || props.accessibilityLabel === 'expenses.monthNavNextA11y')
      );
    });
    expect(monthNavBtns.length).toBe(2);
    monthNavBtns.forEach((btn) => {
      const label = (btn.props as Record<string, unknown>).accessibilityLabel;
      expect(label).toBeTruthy();
      expect(typeof label).toBe('string');
    });
  });
});

describe('ExpensesScreen — review fix: "jump to current month" pill is not hardcoded bilingual', () => {
  it('does not render the old bilingual literal "⬤ เดือนนี้ / This month"', () => {
    // Force isCurrentMonth=false by making the initial viewYear/viewMonth
    // useState calls resolve to a past month (1st and 2nd useState calls:
    // viewYear, viewMonth).
    const useStateMock = React.useState as unknown as jest.Mock;
    useStateMock
      .mockImplementationOnce(() => [2020, jest.fn()]) // viewYear
      .mockImplementationOnce(() => [1, jest.fn()]);    // viewMonth

    const tree = ExpensesScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    expect(texts).not.toContain('⬤ เดือนนี้ / This month');
  });
});

describe('ExpensesScreen — review fix: form echo-line date is formatted (พ.ศ.), not raw ISO', () => {
  it('the echo line shows the formatCivilDate output for the current form.incurredOn, not raw ISO', () => {
    const tree = ExpensesScreen(baseProps) as React.ReactElement;
    const texts = collectText(tree);
    // emptyForm() seeds incurredOn = today's local civil date; assert the
    // rendered echo/date text is never a raw unformatted "YYYY-MM-DD" string.
    const rawIsoLike = texts.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
    expect(rawIsoLike).toHaveLength(0);
  });
});

describe('ExpensesScreen — review fix: error banner has a visible retry affordance', () => {
  it('error banner (when syncError is set) has accessibilityRole="button" and a visible retry label', () => {
    const useStateMock = React.useState as unknown as jest.Mock;
    // useState order: viewYear(0) viewMonth(1) allRecords(2) formVisible(3)
    // form(4) syncing(5) syncError(6) isOffline(7) ...
    useStateMock
      .mockImplementationOnce((init: unknown) => [init, jest.fn()]) // viewYear
      .mockImplementationOnce((init: unknown) => [init, jest.fn()]) // viewMonth
      .mockImplementationOnce((init: unknown) => [init, jest.fn()]) // allRecords
      .mockImplementationOnce((init: unknown) => [init, jest.fn()]) // formVisible
      .mockImplementationOnce((init: unknown) => [init, jest.fn()]) // form
      .mockImplementationOnce((init: unknown) => [init, jest.fn()]) // syncing
      .mockImplementationOnce(() => ['expenses.syncError', jest.fn()]); // syncError

    const tree = ExpensesScreen(baseProps) as React.ReactElement;
    const errorBanner = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'expenses-error')[0];
    expect(errorBanner).toBeTruthy();
    expect((errorBanner!.props as Record<string, unknown>).accessibilityRole).toBe('button');
    const label = (errorBanner!.props as Record<string, unknown>).accessibilityLabel as string;
    expect(label).toContain('general.retry');

    const retryTexts = findAll(errorBanner!, (el) => el.type === 'Text').map(
      (el) => (el.props as { children?: unknown }).children,
    );
    expect(retryTexts).toContain('general.retry');
  });
});
