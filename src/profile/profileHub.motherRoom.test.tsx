/**
 * profileHub.motherRoom.test.tsx
 * TDD: ห้องแม่ Phase 2 B4 reskin — ProfileHubScreen
 *
 * Token migration: no IBMPlex, no banned hex, no deprecated aliases,
 * no textTransform:uppercase on section labels.
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o, hairlineWidth: 0.5 },
  Alert: { alert: jest.fn() }, ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
}));

jest.mock('react', () => {
  const r = jest.requireActual('react') as typeof import('react');
  return { ...r, useState: jest.fn((i: unknown) => [i, jest.fn()]) };
});

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot: jest.fn(() => null),
}));
jest.mock('../accountRights/useAccountRights', () => ({
  useAccountRights: jest.fn(() => ({
    exportPhase: 'IDLE', exportErrorMsg: null, isExportInProgress: false,
    showAccountRightsRows: true, handleExportRowTap: jest.fn(), handleExportRetry: jest.fn(),
    handleExportDismiss: jest.fn(), handleExport404Back: jest.fn(),
    deleteSheetVisible: false, stepUpDegraded: false, deleteInFlight: false,
    deleteError: null, confirmInput: '', setConfirmInput: jest.fn(),
    handleDeleteRowTap: jest.fn(), handleSheetCancel: jest.fn(),
    handleNudgeDownloadTap: jest.fn(), handleNudgeSkipTap: jest.fn(),
    handleConfirmTap: jest.fn(), handleDeleteRetry: jest.fn(), locale: 'th',
  })),
}));
jest.mock('../accountRights/DeleteAccountSheet', () => ({ DeleteAccountSheet: () => null }));
jest.mock('./profileHubTestIds', () => ({
  PROFILE_HUB_TESTIDS: {
    screen: 'profile-hub-screen', screenHeader: 'profile-hub-header',
    summaryCard: 'profile-hub-summary-card', editPregnancyBtn: 'profile-hub-edit-pregnancy',
    editPersonalInfoBtn: 'profile-hub-edit-personal-info', pregnancySummaryBtn: 'profile-hub-pregnancy-summary',
    downloadDataBtn: 'profile-hub-download-data', downloadSpinner: 'profile-hub-download-spinner',
    exportErrorCard: 'profile-hub-export-error', exportRetryBtn: 'profile-hub-export-retry',
    exportDismissBtn: 'profile-hub-export-dismiss', export404Notice: 'profile-hub-export-404',
    export404BackBtn: 'profile-hub-export-404-back', deleteAccountBtn: 'profile-hub-delete-account',
    settingsBtn: 'profile-hub-settings', logout: 'profile-hub-logout',
  },
}));
jest.mock('../i18n/messages', () => ({ formatCivilDate: jest.fn((d: string) => d) }));
jest.mock('./profileHubSummary', () => ({
  buildPostpartumSummaryText: jest.fn(() => ''),
  buildLogoutAlertConfig: jest.fn(() => ['', '']),
  buildMotherNameSummary: jest.fn(() => 'คุณแม่'),
}));

import React from 'react';
import { ProfileHubScreen } from './ProfileHubScreen';
import { T } from '../theme/tokens';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const baseProps = {
  tokenStorage: mockTokenStorage,
  onLogout: jest.fn(),
  onEditPregnancy: jest.fn(),
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
  walk(node); return acc;
}

function flat(s: unknown): Record<string, unknown> {
  if (Array.isArray(s)) return Object.assign({}, ...s.map(flat));
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  return {};
}

describe('ProfileHubScreen — ห้องแม่ Phase 2 B4 reskin', () => {
  it('no elements use IBMPlexSans or IBMPlexMono', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return typeof s.fontFamily === 'string' && (s.fontFamily as string).includes('IBMPlex');
    })).toHaveLength(0);
  });

  it('no elements use banned ink-faint #94818A', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#94818A' || s.backgroundColor === '#94818A';
    })).toHaveLength(0);
  });

  it('no elements use banned ink-soft #5F4A52', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#5F4A52' || s.backgroundColor === '#5F4A52';
    })).toHaveLength(0);
  });

  it('no elements use banned ink #3A2A30', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#3A2A30' || s.backgroundColor === '#3A2A30';
    })).toHaveLength(0);
  });

  it('no elements use old rose-700 #8E3A44', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#8E3A44' || s.backgroundColor === '#8E3A44';
    })).toHaveLength(0);
  });

  it('no elements use white #FFFFFF for bg (nested surfaces)', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.backgroundColor === '#FFFFFF';
    })).toHaveLength(0);
  });

  it('no elements use old rose/600 #A8505A', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.color === '#A8505A' || s.backgroundColor === '#A8505A' || s.borderColor === '#A8505A';
    })).toHaveLength(0);
  });

  it('no section label has textTransform uppercase', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    expect(findAll(tree, (el) => {
      const s = flat((el.props as Record<string, unknown>).style);
      return s.textTransform === 'uppercase';
    })).toHaveLength(0);
  });

  it('container bg is T.color.surface.base', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    const s = flat((tree.props as Record<string, unknown>).style);
    expect(s.backgroundColor).toBe(T.color.surface.base);
  });

  it('ActivityIndicator color is T.color.accent.interactive (not #9B1C35)', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    const spinners = findAll(tree, (el) => String(el.type) === 'ActivityIndicator');
    for (const s of spinners) {
      const p = s.props as Record<string, unknown>;
      expect(p.color).not.toBe('#9B1C35');
    }
  });

  // ─── Missing fontFamily FIX (CLUSTER 2 review) ────────────────────────────
  //
  // FAIL-ON-REVERT: logoutText / settings menuRowText previously had NO
  // fontFamily at all — they silently fell back to the OS default sans
  // (Roboto/San Francisco), not Sarabun. Every text style object in the
  // ScrollView content must now declare fontFamily.

  it('FAIL-ON-REVERT: logout row text style has fontFamily set', () => {
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    const logoutTextEl = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'home.logout')[0];
    expect(logoutTextEl).toBeDefined();
    const s = flat((logoutTextEl!.props as Record<string, unknown>).style);
    expect(typeof s.fontFamily).toBe('string');
    expect(s.fontFamily).toBe(T.type.label.fontFamily);
  });

  it('FAIL-ON-REVERT: settings menu row text style has fontFamily set', () => {
    const tree = ProfileHubScreen({ ...baseProps, onSettings: jest.fn() }) as React.ReactElement;
    const settingsTextEl = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'settings.navTitle')[0];
    expect(settingsTextEl).toBeDefined();
    const s = flat((settingsTextEl!.props as Record<string, unknown>).style);
    expect(typeof s.fontFamily).toBe('string');
    expect(s.fontFamily).toBe(T.type.label.fontFamily);
  });

  it('FAIL-ON-REVERT: badgeText style has lineHeight set (Thai clip fix)', () => {
    const snapshotMock = jest.requireMock('../pregnancy/PregnancyProfileContext') as {
      useProfileSnapshot: jest.Mock;
    };
    snapshotMock.useProfileSnapshot.mockReturnValueOnce({
      lifecycle: 'pregnant',
      gestationalWeek: 20,
      edd: null,
      motherFirstNameDecoded: null,
      birthDate: null,
      todayCivil: '2026-07-11',
    });
    const tree = ProfileHubScreen(baseProps) as React.ReactElement;
    const badgeTextEl = findAll(tree, (el) => (el.props as Record<string, unknown>).children === 'profile.summary.badgePregnant')[0];
    expect(badgeTextEl).toBeDefined();
    const s = flat((badgeTextEl!.props as Record<string, unknown>).style);
    expect(typeof s.lineHeight).toBe('number');
  });
});
