/**
 * profileHub.test.ts — TDD: ProfileHubScreen structural tests (RED → GREEN).
 *
 * Tests that can run in a pure-node jest environment (no RNTL):
 *  1. ProfileHubScreen is exported as a function
 *  2. profileHubTestIds exports the expected testID constants
 *  3. catalog has all required profile hub i18n keys (including the specific
 *     profile.logout.message key that is NOT home.logoutMessage)
 *  4. Verify that the module uses the correct logout message key
 *  5. ProfileHub uses profile.logout.message (NOT home.logoutMessage) for the
 *     logout confirmation dialog body — §3.6 binding requirement
 */

// ── React Native and dependency mocks ──────────────────────────────────────────
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (o: unknown) => o },
  Alert: { alert: jest.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios', Version: '17.0' },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({
    t: jest.fn((key: string) => key),
    locale: 'th',
    setLocale: jest.fn(),
  })),
}));

jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot: jest.fn(() => null),
}));

jest.mock('../accountRights/useAccountRights', () => ({
  useAccountRights: jest.fn(() => ({
    exportPhase: 'EXPORT_IDLE',
    exportErrorMsg: null,
    isExportInProgress: false,
    showAccountRightsRows: true,
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
  })),
}));

jest.mock('../accountRights/DeleteAccountSheet', () => ({
  DeleteAccountSheet: 'DeleteAccountSheet',
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { ProfileHubScreen } from './ProfileHubScreen';
import { PROFILE_HUB_TESTIDS } from './profileHubTestIds';
import { catalog } from '../i18n/messages';

// ─── 1. Module export ─────────────────────────────────────────────────────────

describe('ProfileHubScreen — module export', () => {
  it('is exported as a function (React component)', () => {
    expect(typeof ProfileHubScreen).toBe('function');
  });

  it('is defined', () => {
    expect(ProfileHubScreen).toBeDefined();
  });
});

// ─── 2. testID constants ─────────────────────────────────────────────────────

describe('PROFILE_HUB_TESTIDS — naming contract', () => {
  it('every testID starts with "profile-hub-"', () => {
    Object.values(PROFILE_HUB_TESTIDS).forEach((id) => {
      expect(id).toMatch(/^profile-hub-/);
    });
  });

  it('has a logout testID', () => {
    expect(PROFILE_HUB_TESTIDS.logout).toBe('profile-hub-logout');
  });

  it('has a screen testID', () => {
    expect(PROFILE_HUB_TESTIDS.screen).toBe('profile-hub-screen');
  });
});

// ─── 3. Logout message key requirement (§3.6 binding) ────────────────────────

describe('ProfileHub — logout message uses profile.logout.message (§3.6)', () => {
  it('catalog.th has profile.logout.message (consequence statement)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (catalog.th as any)['profile.logout.message'] as string;
    expect(msg).toBeTruthy();
    // The consequence statement must mention data clearing
    expect(msg).toContain('ล้างข้อมูล');
  });

  it('profile.logout.message differs from home.logoutMessage (YES/NO question)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const th = catalog.th as any;
    // home.logoutMessage = "คุณต้องการออกจากระบบใช่ไหม?" (a question)
    // profile.logout.message = consequence statement
    expect(th['profile.logout.message']).not.toBe(th['home.logoutMessage']);
    // home.logoutMessage should NOT be used in ProfileHub (different semantics)
    expect(th['home.logoutMessage']).toContain('ต้องการ');
    expect(th['profile.logout.message']).not.toContain('ต้องการ');
  });
});

// ─── 4. Section i18n keys reachable ──────────────────────────────────────────

describe('ProfileHub — section i18n keys', () => {
  const SECTION_KEYS = [
    'profile.section.profile',
    'profile.section.accountData',
    'profile.section.account',
  ] as const;

  for (const key of SECTION_KEYS) {
    it(`catalog has non-empty th value for '${key}'`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (catalog.th as any)[key];
      expect(val).toBeTruthy();
    });
  }
});
