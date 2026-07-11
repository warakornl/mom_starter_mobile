/**
 * profileHubReopenEntry.test.tsx — TDD proof that the reopen entry (Screen C
 * entry, pregnancy-loss-recording-ui.md §4.1) is REACHABLE in production.
 *
 * mobile-reviewer BLOCKER-1: the previous host (ProfileEditScreen) can NEVER
 * render its own body for lifecycle==='ended' — its own GET-outcome resolver
 * guards non-pregnant lifecycles to 'guard-not-editable', and BOTH upstream
 * entries into that screen (RootNavigator's Settings row + ProfileHub's own
 * "Edit pregnancy" row) are themselves gated pregnant-only. So the reopen
 * entry link that lived inside ProfileEditScreen could never be tapped.
 *
 * Fix: ProfileHubScreen reads `useProfileSnapshot()` directly (no GET-gate on
 * the host itself — see ProfileHubScreen.tsx `isPregnant`/`isPostpartum`
 * derivation) and renders regardless of lifecycle. This test proves the
 * reopen entry row renders there when lifecycle==='ended' and that tapping
 * it calls the real navigation callback.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() }, ActivityIndicator: 'ActivityIndicator',
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot: jest.fn(),
}));
jest.mock('../accountRights/useAccountRights', () => ({
  useAccountRights: jest.fn(() => ({
    exportPhase: 'IDLE',
    exportErrorMsg: null,
    isExportInProgress: false,
    showAccountRightsRows: false,
    handleExportRowTap: jest.fn(),
    handleExportRetry: jest.fn(),
    handleExportDismiss: jest.fn(),
    handleExport404Back: jest.fn(),
    deleteSheetVisible: false,
    stepUpDegraded: false,
    deleteInFlight: false,
    deleteError: null,
    confirmInput: '',
    setConfirmInput: jest.fn(),
    handleDeleteRowTap: jest.fn(),
    handleSheetCancel: jest.fn(),
    handleNudgeDownloadTap: jest.fn(),
    handleNudgeSkipTap: jest.fn(),
    handleConfirmTap: jest.fn(),
    handleDeleteRetry: jest.fn(),
    locale: 'th',
  })),
}));
jest.mock('../accountRights/DeleteAccountSheet', () => ({ DeleteAccountSheet: () => null }));

import React from 'react';
import { ProfileHubScreen } from './ProfileHubScreen';
import { useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';

const mockUseProfileSnapshot = useProfileSnapshot as unknown as jest.Mock;
const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };

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

const baseProps = {
  tokenStorage: mockTokenStorage,
  onLogout: jest.fn(),
  onEditPregnancy: jest.fn(),
};

describe('ProfileHubScreen — reopen entry (Screen C entry) reachability (BLOCKER-1 fix)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lifecycle=ended: reopen entry row IS rendered (real reachability — no GET-gate blocks it)', () => {
    mockUseProfileSnapshot.mockReturnValue({
      lifecycle: 'ended',
      gestationalWeek: 20,
      edd: '2026-12-25',
      todayCivil: '2026-07-12',
      generalHealthConsented: true,
    });
    const onReopenPregnancy = jest.fn();
    const tree = ProfileHubScreen({ ...baseProps, onReopenPregnancy }) as React.ReactElement;

    const row = byTestId(tree, 'profile-hub-reopen-pregnancy');
    expect(row).toBeDefined();
    expect((row!.props as { accessibilityRole?: string }).accessibilityRole).toBe('button');
  });

  it('tapping the reopen row calls the REAL onReopenPregnancy callback (production navigate)', () => {
    mockUseProfileSnapshot.mockReturnValue({
      lifecycle: 'ended',
      gestationalWeek: 20,
      edd: '2026-12-25',
      todayCivil: '2026-07-12',
      generalHealthConsented: true,
    });
    const onReopenPregnancy = jest.fn();
    const tree = ProfileHubScreen({ ...baseProps, onReopenPregnancy }) as React.ReactElement;

    const row = byTestId(tree, 'profile-hub-reopen-pregnancy');
    (row!.props as { onPress: () => void }).onPress();
    expect(onReopenPregnancy).toHaveBeenCalledTimes(1);
  });

  it('lifecycle=pregnant: reopen entry row is ABSENT (mutually exclusive with the loss entry, §4.1)', () => {
    mockUseProfileSnapshot.mockReturnValue({
      lifecycle: 'pregnant',
      gestationalWeek: 20,
      edd: '2026-12-25',
      todayCivil: '2026-07-12',
      generalHealthConsented: true,
    });
    const tree = ProfileHubScreen({ ...baseProps, onReopenPregnancy: jest.fn() }) as React.ReactElement;
    expect(byTestId(tree, 'profile-hub-reopen-pregnancy')).toBeUndefined();
  });

  it('lifecycle=postpartum: reopen entry row is ABSENT', () => {
    mockUseProfileSnapshot.mockReturnValue({
      lifecycle: 'postpartum',
      gestationalWeek: 0,
      edd: '2026-12-25',
      todayCivil: '2026-07-12',
      generalHealthConsented: true,
    });
    const tree = ProfileHubScreen({ ...baseProps, onReopenPregnancy: jest.fn() }) as React.ReactElement;
    expect(byTestId(tree, 'profile-hub-reopen-pregnancy')).toBeUndefined();
  });

  it('null snapshot (not yet loaded): reopen entry row is ABSENT (fail-safe, GAP-2)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);
    const tree = ProfileHubScreen({ ...baseProps, onReopenPregnancy: jest.fn() }) as React.ReactElement;
    expect(byTestId(tree, 'profile-hub-reopen-pregnancy')).toBeUndefined();
  });

  it('onReopenPregnancy not provided (prop omitted): row is absent, no crash', () => {
    mockUseProfileSnapshot.mockReturnValue({
      lifecycle: 'ended',
      gestationalWeek: 20,
      edd: '2026-12-25',
      todayCivil: '2026-07-12',
      generalHealthConsented: true,
    });
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(byTestId(tree, 'profile-hub-reopen-pregnancy')).toBeUndefined();
  });
});
