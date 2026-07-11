/**
 * reopenConfirmScreen.motherRoom.test.tsx — TDD for Screen C confirmation (reopen).
 *
 * pregnancy-loss-recording-ui.md §4.2 / functional-spec §15.
 * Symmetric with LossConfirmScreen: "Go back" prominent, quiet Confirm link.
 * No date field — reopen takes no input (functional-spec §7.4).
 * Always available, no expiry/countdown (AC-4.3).
 *
 * mobile-reviewer BLOCKER-1 fix: this screen now does its OWN GET-on-mount
 * via runReopenEntryGet (mirrors ProfileInfoEditScreen's lifecycle-agnostic
 * pattern) instead of requiring a route param `profileVersion` — the
 * previous design was unreachable in production because the only host that
 * rendered its entry link (ProfileEditScreen) is gated pregnant-only and can
 * never show a lifecycle==='ended' profile. The wiring itself
 * (runReopenEntryGet / runReopenConfirm) is tested directly, without React,
 * in reopenEntryRuntimeWiring.test.ts. This file drives the REAL rendered
 * controls once `outcome` is seeded to 'show-form' (mocked useState's first
 * call returns the seeded value), proving the screen wires those pure
 * functions to its render + real controls.
 *
 * mobile-reviewer BLOCKER-2 fix: network/5xx failure must NOT be treated as
 * success. runReopenConfirm (tested separately) never calls onReopened on
 * those paths; this file proves the screen invokes runReopenConfirm (the
 * real wiring, not a bypass) from the real Confirm control.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', SafeAreaView: 'SafeAreaView', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => [init, jest.fn()]),
    useEffect: jest.fn(),
    useCallback: jest.fn((fn: unknown) => fn),
  };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./reopenEntryRuntimeWiring', () => ({
  runReopenEntryGet: jest.fn(),
  runReopenConfirm: jest.fn(),
}));

import React from 'react';
import { ReopenConfirmScreen } from './ReopenConfirmScreen';
import { runReopenConfirm } from './reopenEntryRuntimeWiring';
import type { PregnancyProfile } from './types';

const mockUseState = React.useState as unknown as jest.Mock;
const mockRunReopenConfirm = runReopenConfirm as unknown as jest.Mock;

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  onReopened: jest.fn(),
  onGoBack: jest.fn(),
  onSessionExpired: jest.fn(),
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
  walk(node);
  return acc;
}

function byTestId(tree: unknown, id: string): React.ReactElement | undefined {
  return findAll(tree, (el) => (el.props as { testID?: string }).testID === id)[0];
}

function makeProfile(overrides: Partial<PregnancyProfile> = {}): PregnancyProfile {
  return {
    id: 'p1',
    version: 9,
    edd: '2026-12-25',
    eddBasis: 'due_date',
    lifecycle: 'ended',
    gestationalWeek: 20,
    gestationalDay: 0,
    daysRemaining: 100,
    progress: 0.5,
    currentStage: 'T2',
    deliveryWindowActive: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Seeds the FIRST useState call (`outcome`) to 'show-form' with the given
 * profile; every subsequent useState call falls back to the generic
 * "return the initializer" pattern used elsewhere in this test suite.
 */
function seedShowForm(profile: PregnancyProfile): void {
  let callIndex = 0;
  mockUseState.mockImplementation((init: unknown) => {
    callIndex += 1;
    if (callIndex === 1) {
      return [{ type: 'show-form', profile }, jest.fn()];
    }
    return [init, jest.fn()];
  });
}

describe('ReopenConfirmScreen — loading state (before GET resolves)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseState.mockImplementation((init: unknown) => [init, jest.fn()]);
  });

  it('renders the loading testID on initial render (outcome defaults to loading)', () => {
    const tree = ReopenConfirmScreen(baseProps) as React.ReactElement;
    expect(byTestId(tree, 'reopen-confirm-loading')).toBeDefined();
  });
});

describe('ReopenConfirmScreen — show-form render (real controls)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedShowForm(makeProfile());
  });

  it('renders "Go back" as a prominent button and quiet Confirm as a link', () => {
    const tree = ReopenConfirmScreen(baseProps) as React.ReactElement;
    const goBack = byTestId(tree, 'reopen-confirm-goback');
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    expect((goBack!.props as { accessibilityRole?: string }).accessibilityRole).toBe('button');
    expect((confirm!.props as { accessibilityRole?: string }).accessibilityRole).toBe('link');
  });

  it('"Go back" tap calls onGoBack, nothing changed', () => {
    const tree = ReopenConfirmScreen(baseProps) as React.ReactElement;
    const goBack = byTestId(tree, 'reopen-confirm-goback');
    (goBack!.props as { onPress: () => void }).onPress();
    expect(baseProps.onGoBack).toHaveBeenCalledTimes(1);
  });

  it('tapping the REAL quiet Confirm control invokes the real runReopenConfirm wiring (not a bypass)', () => {
    seedShowForm(makeProfile({ version: 9 }));
    const tree = ReopenConfirmScreen(baseProps) as React.ReactElement;
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    (confirm!.props as { onPress: () => void }).onPress();

    expect(mockRunReopenConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        profileVersion: 9,
        tokenStorage: mockTokenStorage,
        apiBaseUrl: 'https://api.example.com',
      }),
    );
    // onReopened/onError are passed through as callbacks — the real wiring
    // module (tested separately, no false-success) decides when to call them.
    const callArg = mockRunReopenConfirm.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof callArg.onReopened).toBe('function');
    expect(typeof callArg.onError).toBe('function');
  });
});
