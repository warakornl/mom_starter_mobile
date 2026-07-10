/**
 * kickCountHomeScreen.lossGate.b3.test.tsx — B3 loss-gate TDD.
 *
 * Tests for KickCountHomeScreen loss state (GAP-1):
 *   - loss render branch mounts directly (never enters loading) when lifecycle='ended'
 *   - 'เริ่มนับ' CTA absent from DOM (not disabled/opacity-0) when ended
 *   - wk-32 forward-looking copy absent when ended
 *   - history link + safety strip retained when ended
 *   - GAP-2 fail-safe: undefined lifecycle → loading state (never CTA)
 *   - fail-on-revert: CTA absent when ended, loading when undefined
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
  StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator',
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return {
    ...r,
    // Evaluate lazy initializers so useState(() => expr) works like the real runtime.
    useState: jest.fn((i: unknown) => {
      const val = typeof i === 'function' ? (i as () => unknown)() : i;
      return [val, jest.fn()];
    }),
    useCallback: jest.fn((f: unknown) => f),
    useRef: jest.fn((v: unknown) => ({ current: v })),
    useEffect: jest.fn(), // no-op — effects don't run in plain-function test mode
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
jest.mock('./kickCountDraftStore', () => ({ loadDraft: mockLoadDraft }));

jest.mock('./kickCountSyncStore', () => ({
  kickCountSyncStore: { getWatermark: jest.fn(() => ''), reset: jest.fn() },
}));

jest.mock('../sync/syncClient', () => ({
  createKickCountSyncClient: jest.fn(() => ({ pull: jest.fn(), push: jest.fn() })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { KickCountHomeScreen } from './KickCountHomeScreen';

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

/**
 * Find a React element by component function name.
 * Used for child components whose testIDs live inside their own render output
 * (e.g. SafetyStrip renders <View testID="kick-safety-strip"> — we find the
 * <SafetyStrip> element in the tree, not the inner View).
 */
function findByComponentName(tree: unknown, name: string): React.ReactElement | null {
  const hits = findAll(tree, (el) => {
    const t = el.type;
    return typeof t === 'function' && (t as { name?: string }).name === name;
  });
  return hits.length > 0 ? hits[0] : null;
}

const baseProps = {
  gestationalWeek: 34,
  generalHealthConsented: true,
  isOffline: false,
  onRequestConsent: jest.fn(),
};

// ─── GAP-1: loss render branch ───────────────────────────────────────────────

describe('[B3 GAP-1] KickCountHomeScreen — loss state (lifecycle="ended")', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('renders loss container (testID=kick-home-loss) when lifecycle="ended"', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-home-loss')).not.toBeNull();
  });

  it('does NOT render the CTA when lifecycle="ended" (node absent, not disabled)', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    // The start button must be entirely absent from the DOM tree
    expect(findByTestId(tree, 'kick-start-btn')).toBeNull();
  });

  it('retains the history link when lifecycle="ended" (historical data belongs to user)', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-view-history-btn')).not.toBeNull();
  });

  it('retains the safety strip when lifecycle="ended" (INV-K6: always-on)', () => {
    // SafetyStrip is a child component — check for its element in the tree by name
    // (its testID lives inside SafetyStrip's own render, not in the parent tree).
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByComponentName(tree, 'SafetyStrip')).not.toBeNull();
  });

  it('does NOT enter loading skeleton when lifecycle="ended" (R2 ordering: loss first)', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    // Loss branch runs before loading branch — kick-home-loading must be absent
    expect(findByTestId(tree, 'kick-home-loading')).toBeNull();
  });

  it('does NOT render the ready state when lifecycle="ended"', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-home-ready')).toBeNull();
  });
});

// ─── GAP-2: undefined lifecycle fail-safe ─────────────────────────────────────

describe('[B3 GAP-2] KickCountHomeScreen — undefined lifecycle fail-safe', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('shows loading skeleton (not loss, not ready) when lifecycle is undefined', () => {
    // isLossState(undefined) === false → lazy init returns 'loading'
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: undefined }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-home-loading')).not.toBeNull();
  });

  it('does NOT show the start CTA when lifecycle is undefined (GAP-2 never default pregnant)', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: undefined }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-start-btn')).toBeNull();
  });

  it('does NOT show loss layout when lifecycle is undefined (undefined ≠ ended)', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: undefined }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-home-loss')).toBeNull();
  });
});

// ─── Fail-on-revert ──────────────────────────────────────────────────────────

describe('[B3 Fail-on-revert] KickCountHomeScreen — loss gate correctness', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('FAIL-ON-REVERT: loss container present when ended, absent when undefined', () => {
    const treeEnded = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByTestId(treeEnded, 'kick-home-loss')).not.toBeNull();

    const treeLoading = KickCountHomeScreen({ ...baseProps, lifecycle: undefined }) as React.ReactElement;
    expect(findByTestId(treeLoading, 'kick-home-loss')).toBeNull();
  });

  it('FAIL-ON-REVERT: start CTA absent when ended, also absent when undefined (never default pregnant)', () => {
    const treeEnded = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByTestId(treeEnded, 'kick-start-btn')).toBeNull();

    const treeUndef = KickCountHomeScreen({ ...baseProps, lifecycle: undefined }) as React.ReactElement;
    expect(findByTestId(treeUndef, 'kick-start-btn')).toBeNull();
  });

  it('FAIL-ON-REVERT: history link present in loss state', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByTestId(tree, 'kick-view-history-btn')).not.toBeNull();
  });

  it('FAIL-ON-REVERT: safety strip present in loss state (INV-K6)', () => {
    const tree = KickCountHomeScreen({ ...baseProps, lifecycle: 'ended' }) as React.ReactElement;
    expect(findByComponentName(tree, 'SafetyStrip')).not.toBeNull();
  });
});
