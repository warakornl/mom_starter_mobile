/**
 * kickCountCountingScreen.lossGate.b3.test.tsx — B3 G2-DELIV TDD.
 *
 * Tests for KickCountCountingScreen loss gate (G2-DELIV, in-screen mechanism):
 *   - Full-page replacement (testID=kick-counting-loss) when lifecycle='ended'
 *   - Normal counting content (kick-tap-btn) absent when ended
 *   - Back button (kick-counting-loss-back-btn) present when ended
 *   - GAP-2: null snapshot → same guarded screen (never live counting UI)
 *   - Fail-on-revert: replacement ABSENT when lifecycle='pregnant' (loading shown)
 *
 * Mechanism (D-G2): the screen reads useProfileSnapshot() IN-SCREEN, not a prop.
 * Tests mock useProfileSnapshot directly — this proves D-G2 (the guard originates
 * from in-screen context, not a navigator prop).
 *
 * Pattern: call the component as a plain function and walk the React element tree
 * (identical to captureScreen.motherRoom.test.tsx — no RNTL required).
 *
 * K-8: tests never log movementCount or any draft/session field.
 */

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal',
  StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() },
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    useState: jest.fn((i: unknown) => [i, jest.fn()]),
    useCallback: jest.fn((f: unknown) => f),
    useRef: jest.fn((v: unknown) => ({ current: v })),
    useEffect: jest.fn(),
    useMemo: jest.fn((f: unknown) => typeof f === 'function' ? (f as () => unknown)() : f),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({ navigate: jest.fn(), goBack: jest.fn() })),
}));

jest.mock('@react-navigation/native-stack', () => ({}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('../i18n/messages', () => ({
  interpolate: jest.fn((k: string) => k),
}));

const mockLoadDraft = jest.fn().mockResolvedValue(null);
const mockSaveDraft = jest.fn().mockResolvedValue(undefined);
const mockClearDraft = jest.fn().mockResolvedValue(undefined);
jest.mock('./kickCountDraftStore', () => ({
  loadDraft: mockLoadDraft,
  saveDraft: mockSaveDraft,
  clearDraft: mockClearDraft,
}));

jest.mock('./serialSaveQueue', () => ({
  createSerialSaveQueue: () => (fn: () => Promise<void>) => fn(),
}));

jest.mock('./kickCountSyncStore', () => ({
  kickCountSyncStore: {
    getWatermark: jest.fn(() => ''),
    addSession: jest.fn(),
    enqueueCreate: jest.fn(),
    reset: jest.fn(),
  },
}));

jest.mock('../sync/syncClient', () => ({
  createKickCountSyncClient: jest.fn(() => ({ push: jest.fn(), pull: jest.fn() })),
}));

jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(),
}));

// D-G2: mock useProfileSnapshot — this is the in-screen mechanism being tested.
const mockUseProfileSnapshot = jest.fn();
jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot: mockUseProfileSnapshot,
}));

jest.mock('./kickCountTimerStyleTokens', () => ({
  timerStyleTokens: {
    timerFontSize: 36,
    countDisplay: {},
    countLabel: {},
    timerDisplay: {},
  },
}));

// All kickCountLogic functions needed by the screen hooks.
jest.mock('./kickCountLogic', () => ({
  isLossState: (lifecycle: unknown) => lifecycle === 'ended',
  shouldShowModule: jest.fn(() => true),
  isStartAllowedByWeek: jest.fn(() => true),
  finalizeSession: jest.fn(() => ({ id: 'test-session-id' })),
  cancelSession: jest.fn(),
  computeGestationalWeekAtStart: jest.fn(() => 34),
  getProgressDisplay: jest.fn(() => ({ count: 0, targetCount: 10 })),
  createTapHandler: jest.fn(() => jest.fn()),
  createUndoHandler: jest.fn(() => jest.fn()),
  isConsentGateOpen: jest.fn(() => true),
  newDraftId: jest.fn(() => 'test-draft-id'),
}));

// SafetyStrip is re-exported from KickCountHomeScreen — mock to avoid cascading deps.
jest.mock('./KickCountHomeScreen', () => ({
  SafetyStrip: 'SafetyStrip',
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { KickCountCountingScreen } from './KickCountCountingScreen';

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

function findByTestId(tree: unknown, testID: string): React.ReactElement | null {
  const hits = findAll(tree, (el) =>
    (el.props as Record<string, unknown>).testID === testID,
  );
  return hits.length > 0 ? hits[0] : null;
}

const baseProps = {
  edd: '2026-10-08',
  todayCivil: '2026-07-10',
  generalHealthConsented: true,
  getCivilNow: () => '2026-07-10T09:00',
  getMonotonicMs: () => 0,
};

const ENDED_SNAPSHOT = {
  lifecycle: 'ended' as const,
  gestationalWeek: 0,
  edd: '2026-10-08',
  todayCivil: '2026-07-10',
  generalHealthConsented: false,
};

const PREGNANT_SNAPSHOT = {
  lifecycle: 'pregnant' as const,
  gestationalWeek: 34,
  edd: '2026-10-08',
  todayCivil: '2026-07-10',
  generalHealthConsented: true,
};

// ─── G2-DELIV-a: loss guard fires from in-screen context read ─────────────────

describe('[B3 G2-DELIV] KickCountCountingScreen — in-screen loss guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loss container (testID=kick-counting-loss) when lifecycle="ended"', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(tree, 'kick-counting-loss')).not.toBeNull();
  });

  it('renders a back button in the loss replacement when lifecycle="ended"', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(tree, 'kick-counting-loss-back-btn')).not.toBeNull();
  });

  it('does NOT render the tap area when lifecycle="ended"', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(tree, 'kick-tap-btn')).toBeNull();
  });

  it('does NOT render the counting screen container when lifecycle="ended"', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(tree, 'kick-counting-screen')).toBeNull();
  });
});

// ─── GAP-2 fail-safe: null snapshot → guarded screen ─────────────────────────

describe('[B3 GAP-2] KickCountCountingScreen — null snapshot fail-safe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loss container when snapshot is null (unknown state → guard fires)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(tree, 'kick-counting-loss')).not.toBeNull();
  });

  it('does NOT render tap area when snapshot is null (fail-safe K-8)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(tree, 'kick-tap-btn')).toBeNull();
  });
});

// ─── Fail-on-revert: replacement ABSENT when pregnant ────────────────────────

describe('[B3 Fail-on-revert] KickCountCountingScreen — loss replacement absent when pregnant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('FAIL-ON-REVERT: loss container absent when lifecycle="pregnant" (loading shown instead)', () => {
    mockUseProfileSnapshot.mockReturnValue(PREGNANT_SNAPSHOT);
    const tree = KickCountCountingScreen(baseProps) as React.ReactElement;
    // Pregnant → no loss, phase='loading' → shows loading screen
    expect(findByTestId(tree, 'kick-counting-loss')).toBeNull();
  });

  it('FAIL-ON-REVERT: useProfileSnapshot drives the guard (D-G2 in-screen mechanism)', () => {
    // Ended snapshot → loss container present
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    const treeEnded = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(treeEnded, 'kick-counting-loss')).not.toBeNull();

    // Pregnant snapshot → loss container absent
    mockUseProfileSnapshot.mockReturnValue(PREGNANT_SNAPSHOT);
    const treePregnant = KickCountCountingScreen(baseProps) as React.ReactElement;
    expect(findByTestId(treePregnant, 'kick-counting-loss')).toBeNull();
  });
});
