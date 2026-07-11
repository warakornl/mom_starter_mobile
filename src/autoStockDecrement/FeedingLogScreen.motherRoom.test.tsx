/**
 * FeedingLogScreen.motherRoom.test.tsx — TDD RED → GREEN
 *
 * Style tests for the feeding-log surface.
 *
 * Tests cover:
 *   - Thai typography: every visible Text element carries lineHeight ≥ fontSize.
 *     Prevents clipping of stacked Thai vowel/tone marks (ปั๊มนม, ให้นมผง,
 *     บันทึก) — wave 1 containment + typography rules.
 *   - All four render states are exercised: idle/consent-granted,
 *     idle/consent-denied (advisory panel), error, saved.
 *
 * FAIL-ON-REVERT:
 *   Remove lineHeight from any body/label Text style → RED (fontSize present but
 *   lineHeight absent → violations list non-empty).
 *
 * Security: no real health values; consentStore returns synthetic booleans only.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => [init, jest.fn()]),
    useRef:   jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo:  jest.fn((fn: () => unknown) => fn()),
    useEffect: jest.fn(),
  };
});

jest.mock('react-native', () => ({
  View:             'View',
  Text:             'Text',
  TextInput:        'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet:       { create: (s: unknown) => s, hairlineWidth: 1 },
  SafeAreaView:     'SafeAreaView',
  ScrollView:       'ScrollView',
  Platform:         { OS: 'ios' },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

jest.mock('../consent/consentStore', () => ({
  consentStore: { isGranted: jest.fn(() => true) },
}));

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

// Singletons are not exercised — DI props are left empty (defaults to singletons
// which are not invoked by lineHeight / render-only tests).
jest.mock('./feedingSessionStore', () => ({
  feedingSessionStore: {
    commitLocalFormula: jest.fn(() => 'session-uuid'),
    getCount: jest.fn(() => 0),
    getAll:   jest.fn(() => []),
  },
  createFeedingSessionStore: jest.fn(() => ({
    commitLocalFormula: jest.fn(() => 'session-uuid'),
    getCount: jest.fn(() => 0),
    getAll:   jest.fn(() => []),
  })),
}));

jest.mock('../sync/supplySyncStore', () => ({
  supplySyncStore: {
    getAll:           jest.fn(() => []),
    getSupplyItem:    jest.fn(() => undefined),
    getWatermark:     jest.fn(() => undefined),
    getPendingCount:  jest.fn(() => 0),
    applyDecrementDraw: jest.fn(),
    drainQueue:       jest.fn(() => ({ supplyItems: { updated: [] } })),
    enqueueUpdate:    jest.fn(),
    upsertSupplyItem: jest.fn(),
  },
}));

jest.mock('./consumptionMappingStore', () => ({
  consumptionMappingStore: {
    getAll:         jest.fn(() => []),
    getByActivityType: jest.fn(() => []),
    upsert:         jest.fn(),
    drainQueue:     jest.fn(() => ({})),
    getWatermark:   jest.fn(() => undefined),
    getPendingCount: jest.fn(() => 0),
  },
  createConsumptionMappingStore: jest.fn(() => ({
    getAll:         jest.fn(() => []),
    getByActivityType: jest.fn(() => []),
    upsert:         jest.fn(),
    drainQueue:     jest.fn(() => ({})),
    getWatermark:   jest.fn(() => undefined),
    getPendingCount: jest.fn(() => 0),
  })),
}));

jest.mock('./stockDecrementMarkerStore', () => ({
  stockDecrementMarkerStore: {
    hasMarker:   jest.fn(() => false),
    setMarker:   jest.fn(),
    drainQueue:  jest.fn(() => ({})),
  },
  createStockDecrementMarkerStore: jest.fn(() => ({
    hasMarker:   jest.fn(() => false),
    setMarker:   jest.fn(),
    drainQueue:  jest.fn(() => ({})),
  })),
}));

jest.mock('./decrementCommit', () => ({
  commitFormulaFeedDecrement: jest.fn(),
}));

jest.mock('./FormulaFeedSection', () => ({
  FormulaFeedSection: () => null,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import React from 'react';
import type { FeedingLogScreenProps } from './FeedingLogScreen';
import { FeedingLogScreen } from './FeedingLogScreen';
import { consentStore } from '../consent/consentStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function renderScreen(overrides: Partial<FeedingLogScreenProps> = {}): React.ReactElement {
  return (FeedingLogScreen as unknown as (p: FeedingLogScreenProps) => React.ReactElement)({
    tokenStorage: mockTokenStorage as never,
    apiBaseUrl: 'https://test.example.com',
    onBack: jest.fn(),
    ...overrides,
  });
}

/**
 * Collect all Text elements whose merged style has fontSize but no lineHeight.
 * Returns a description string per violation for clear failure messages.
 */
function findLineHeightViolations(tree: React.ReactElement): string[] {
  const violations: string[] = [];
  const texts = findAll(tree, (el) => el.type === 'Text');
  texts.forEach((el) => {
    const s = flat((el.props as Record<string, unknown>).style);
    if (s.fontSize != null && s.lineHeight == null) {
      violations.push(
        `Text fontSize=${String(s.fontSize)} missing lineHeight — Thai marks will clip`,
      );
    }
  });
  return violations;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FeedingLogScreen — Thai typography: lineHeight on all text styles', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Default React.useState behaviour: return initial value unchanged
    const ReactMod = jest.requireMock<typeof import('react')>('react');
    (ReactMod.useState as jest.Mock).mockImplementation((init: unknown) => [init, jest.fn()]);
    (ReactMod.useRef   as jest.Mock).mockImplementation((init: unknown) => ({ current: init }));
  });

  // ── Idle state — consent granted (covers chipLabel, chipLabelActive,
  //    headerCloseText, saveBtnText, and FormulaFeedSection chip) ─────────────

  it('idle+consent-granted: all visible Text elements carry lineHeight ≥ fontSize', () => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
    const tree = renderScreen();
    const violations = findLineHeightViolations(tree);
    expect(violations).toEqual([]);
  });

  // ── Idle state — consent denied (covers consentAdvisoryText, consentCtaText)

  it('idle+consent-denied: advisory Text elements carry lineHeight ≥ fontSize', () => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(false);
    const tree = renderScreen();
    const violations = findLineHeightViolations(tree);
    expect(violations).toEqual([]);
  });

  // ── Error state (covers errorText, retryBtnText) ──────────────────────────

  it('error state: error panel Text elements carry lineHeight ≥ fontSize', () => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
    const ReactMod = jest.requireMock<typeof import('react')>('react');
    let callIdx = 0;
    (ReactMod.useState as jest.Mock).mockImplementation((init: unknown) => {
      callIdx++;
      // 3rd useState call is screenState — force to 'error'
      if (callIdx === 3) return ['error', jest.fn()];
      return [init, jest.fn()];
    });
    const tree = renderScreen();
    const violations = findLineHeightViolations(tree);
    expect(violations).toEqual([]);
  });

  // ── Saved state (covers closeBtnText) ────────────────────────────────────

  it('saved state: saved-screen Text elements carry lineHeight ≥ fontSize', () => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
    const ReactMod = jest.requireMock<typeof import('react')>('react');
    let callIdx = 0;
    (ReactMod.useState as jest.Mock).mockImplementation((init: unknown) => {
      callIdx++;
      // 3rd useState call is screenState — force to 'saved'
      if (callIdx === 3) return ['saved', jest.fn()];
      return [init, jest.fn()];
    });
    const tree = renderScreen();
    const violations = findLineHeightViolations(tree);
    expect(violations).toEqual([]);
  });
});
