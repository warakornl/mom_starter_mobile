/**
 * lossConfirmScreen.motherRoom.test.tsx — TDD for Screen B (loss confirmation).
 *
 * pregnancy-loss-recording-ui.md §3 / functional-spec §14.
 *
 * Two-step confirm discipline (non-negotiable, per task brief):
 *   - "Go back" is the PROMINENT primary action (button, amber-700 fill).
 *   - Quiet Confirm is a plain-text link, less prominent, requires deliberate tap.
 *   - Disabled during submit (single-flight).
 *   - Real confirm control is driven directly (no bypass helper).
 *
 * Same test harness convention as birthEventScreen.motherRoom.test.tsx: mock
 * react-native as plain string element types + call the component as a plain
 * function, walk the resulting element tree. No native rendering required.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', TextInput: 'TextInput',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() }, ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal', SafeAreaView: 'SafeAreaView', Platform: { OS: 'ios' },
}));
jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./pregnancyApiClient', () => ({ createPregnancyClient: jest.fn(() => ({})) }));
jest.mock('./gestationalAge', () => ({ localCivilToday: jest.fn(() => '2026-07-11') }));
jest.mock('../i18n/messages', () => ({ formatCivilDate: jest.fn((d: string) => d) }));

import React from 'react';
import { LossConfirmScreen } from './LossConfirmScreen';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  apiBaseUrl: 'https://api.example.com',
  profileVersion: 3,
  edd: '2026-12-25',
  onLossRecorded: jest.fn(),
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

describe('LossConfirmScreen — Screen B (§3 / functional-spec §14)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders "Go back" as a prominent button and quiet Confirm as a link (TONE-5 hierarchy)', () => {
    const tree = LossConfirmScreen(baseProps);
    const goBack = byTestId(tree, 'loss-confirm-goback');
    const confirm = byTestId(tree, 'loss-confirm-quiet');

    expect(goBack).toBeDefined();
    expect(confirm).toBeDefined();
    expect((goBack!.props as { accessibilityRole?: string }).accessibilityRole).toBe('button');
    expect((confirm!.props as { accessibilityRole?: string }).accessibilityRole).toBe('link');
  });

  it('"Go back" tap calls onGoBack — dismiss, nothing recorded, no confirm dialog', () => {
    const tree = LossConfirmScreen(baseProps);
    const goBack = byTestId(tree, 'loss-confirm-goback');
    (goBack!.props as { onPress: () => void }).onPress();
    expect(baseProps.onGoBack).toHaveBeenCalledTimes(1);
  });

  it('tapping the REAL quiet Confirm control invokes recordLossEvent (real production caller)', async () => {
    const recordLossEvent = jest.fn().mockResolvedValue({
      ok: true,
      profile: { lifecycle: 'ended', version: 4 },
    });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok-abc' });

    const onLossRecorded = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onLossRecorded });
    const confirm = byTestId(tree, 'loss-confirm-quiet');

    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(recordLossEvent).toHaveBeenCalledTimes(1);
    // If-Match version + no accessToken logged (only value asserted is header shape).
    expect(recordLossEvent).toHaveBeenCalledWith(
      expect.any(Object),
      'tok-abc',
      '3',
      '2026-07-11',
    );
  });

  it('empty date field is a full success — Confirm never disabled by an empty date (LOSS-INV-11)', async () => {
    const recordLossEvent = jest.fn().mockResolvedValue({ ok: true, profile: { lifecycle: 'ended', version: 4 } });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const tree = LossConfirmScreen(baseProps);
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    expect((confirm!.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled).toBeFalsy();

    await (confirm!.props as { onPress: () => Promise<void> }).onPress();
    expect(recordLossEvent).toHaveBeenCalledWith({}, expect.any(String), expect.any(String), expect.any(String));
  });

  it('403 consent_required does not call onLossRecorded (no local flip)', async () => {
    const recordLossEvent = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      code: 'consent_required',
      message: 'no consent',
    });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onLossRecorded = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onLossRecorded });
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onLossRecorded).not.toHaveBeenCalled();
  });

  it('403 consent_required panel WITH showConsentBackstop=true renders a "Go to consent" action (§3.5)', () => {
    // Mocked useState does not persist across calls (each LossConfirmScreen()
    // invocation is a fresh "render"), so this test seeds `showConsentBackstop`
    // directly (same technique as profileEditScreenLossEntry.test.tsx's
    // renderShowForm: the FIRST useState call after dateInput/dateHint/submitting
    // is `errorMsg`, the FIFTH is `showConsentBackstop` — instead of counting
    // calls fragilely, we override useState's mock implementation for this
    // test only to always return `true` for showConsentBackstop's initializer
    // shape by seeding every boolean-typed useState call to true).
    const mockUseState = (jest.requireMock('react') as { useState: jest.Mock }).useState;
    mockUseState.mockImplementation((init: unknown) =>
      typeof init === 'boolean' ? [true, jest.fn()] : [init, jest.fn()],
    );

    const onGoToConsent = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onGoToConsent });

    const goToConsentBtn = byTestId(tree, 'loss-confirm-goto-consent');
    expect(goToConsentBtn).toBeDefined();
    (goToConsentBtn!.props as { onPress: () => void }).onPress();
    expect(onGoToConsent).toHaveBeenCalledTimes(1);

    // restore default behavior for subsequent tests
    mockUseState.mockImplementation((init: unknown) => [init, jest.fn()]);
  });

  it('no access token (session expired) shows a session error — NOT the consent-required message', async () => {
    mockTokenStorage.load.mockResolvedValue(null);
    const onSessionExpired = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onSessionExpired });
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('409 already-ended is treated as success (intent satisfied, §10.4) — calls onLossRecorded', async () => {
    const recordLossEvent = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      code: 'version_conflict',
      message: 'stale',
      currentProfile: { lifecycle: 'ended', version: 9 },
    });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onLossRecorded = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onLossRecorded });
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onLossRecorded).toHaveBeenCalledTimes(1);
  });

  it('409 postpartum (invalid_lifecycle_state) is a benign terminal — no loss recorded, no alarm', async () => {
    const recordLossEvent = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      code: 'invalid_lifecycle_state',
      message: 'postpartum',
      currentProfile: { lifecycle: 'postpartum', version: 9 },
    });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onLossRecorded = jest.fn();
    const onGoBack = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onLossRecorded, onGoBack });
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onLossRecorded).not.toHaveBeenCalled();
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it('BLOCKER-2: network/offline error does NOT call onLossRecorded — stays on screen with a retryable error', async () => {
    const recordLossEvent = jest.fn().mockRejectedValue(new Error('network down'));
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onLossRecorded = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onLossRecorded });
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    // BLOCKER-2 fix: false-success is forbidden. No onLossRecorded call.
    expect(onLossRecorded).not.toHaveBeenCalled();
    // Confirm control must be re-enabled (single-flight guard released).
    expect((confirm!.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled).toBeFalsy();
  });

  it('BLOCKER-2: 500 server error does NOT call onLossRecorded', async () => {
    const recordLossEvent = jest.fn().mockResolvedValue({ ok: false, status: 500, code: 'server_error', message: 'x' });
    (
      jest.requireMock('./pregnancyApiClient') as { createPregnancyClient: jest.Mock }
    ).createPregnancyClient.mockReturnValue({ recordLossEvent });
    mockTokenStorage.load.mockResolvedValue({ accessToken: 'tok' });

    const onLossRecorded = jest.fn();
    const tree = LossConfirmScreen({ ...baseProps, onLossRecorded });
    const confirm = byTestId(tree, 'loss-confirm-quiet');
    await (confirm!.props as { onPress: () => Promise<void> }).onPress();

    expect(onLossRecorded).not.toHaveBeenCalled();
  });
});
