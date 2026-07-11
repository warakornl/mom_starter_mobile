/**
 * reopenConfirmScreen.motherRoom.test.tsx — TDD for Screen C confirmation (reopen).
 *
 * pregnancy-loss-recording-ui.md §4.2 / functional-spec §15.
 * Symmetric with LossConfirmScreen: "Go back" prominent, quiet Confirm link.
 * No date field — reopen takes no input (functional-spec §7.4).
 * Always available, no expiry/countdown (AC-4.3).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', SafeAreaView: 'SafeAreaView', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./pregnancyApiClient', () => ({ createPregnancyClient: jest.fn(() => ({})) }));

import React from 'react';
import { ReopenConfirmScreen } from './ReopenConfirmScreen';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  profileVersion: 9,
  onReopened: jest.fn(),
  onGoBack: jest.fn(),
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

describe('ReopenConfirmScreen — Screen C confirmation (§4.2 / functional-spec §15)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders "Go back" as a prominent button and quiet Confirm as a link', () => {
    const tree = ReopenConfirmScreen(baseProps);
    const goBack = byTestId(tree, 'reopen-confirm-goback');
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    expect((goBack!.props as { accessibilityRole?: string }).accessibilityRole).toBe('button');
    expect((confirm!.props as { accessibilityRole?: string }).accessibilityRole).toBe('link');
  });

  it('"Go back" tap calls onGoBack, nothing changed', () => {
    const tree = ReopenConfirmScreen(baseProps);
    const goBack = byTestId(tree, 'reopen-confirm-goback');
    (goBack!.props as { onPress: () => void }).onPress();
    expect(baseProps.onGoBack).toHaveBeenCalledTimes(1);
  });

  it('tapping the REAL quiet Confirm control invokes reopenPregnancy (real production caller)', async () => {
    const reopenPregnancy = jest.fn().mockResolvedValue({ ok: true, profile: { lifecycle: 'pregnant', version: 10 } });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ reopenPregnancy });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok-xyz' });

    const onReopened = jest.fn();
    const tree = ReopenConfirmScreen({ ...baseProps, onReopened });
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(reopenPregnancy).toHaveBeenCalledWith('tok-xyz', '9');
    expect(onReopened).toHaveBeenCalledWith({ lifecycle: 'pregnant', version: 10 });
  });

  it('409 already-pregnant is treated as success (intent satisfied, §10.4)', async () => {
    const reopenPregnancy = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      code: 'version_conflict',
      message: 'stale',
      currentProfile: { lifecycle: 'pregnant', version: 11 },
    });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ reopenPregnancy });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onReopened = jest.fn();
    const tree = ReopenConfirmScreen({ ...baseProps, onReopened });
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onReopened).toHaveBeenCalledTimes(1);
  });

  it('409 postpartum is a benign terminal — no reopen, calm close', async () => {
    const reopenPregnancy = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      code: 'invalid_lifecycle_state',
      message: 'postpartum',
      currentProfile: { lifecycle: 'postpartum', version: 11 },
    });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ reopenPregnancy });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onReopened = jest.fn();
    const onGoBack = jest.fn();
    const tree = ReopenConfirmScreen({ ...baseProps, onReopened, onGoBack });
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onReopened).not.toHaveBeenCalled();
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it('network/offline error still honors the action optimistically', async () => {
    const reopenPregnancy = jest.fn().mockRejectedValue(new Error('offline'));
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ reopenPregnancy });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onReopened = jest.fn();
    const tree = ReopenConfirmScreen({ ...baseProps, onReopened });
    const confirm = byTestId(tree, 'reopen-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onReopened).toHaveBeenCalledTimes(1);
  });
});
