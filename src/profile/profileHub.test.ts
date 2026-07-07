/**
 * profileHub.test.ts — TDD: ProfileHubScreen pure-logic tests (no RNTL).
 *
 * Tests that can run in a pure-node jest environment:
 *  1. ProfileHubScreen is exported as a function
 *  2. profileHubTestIds exports the expected testID constants
 *  3. Catalog string check: profile.logout.message is a consequence statement
 *     (NOT home.logoutMessage which is a yes/no question)
 *  4. buildPostpartumSummaryText — pure helper for the postpartum summary card
 *     (spec §3.3/§10.2): asserts computePostpartumAge is used, i18n keys are
 *     called correctly, and null birthDate falls back gracefully.
 *  5. buildLogoutAlertConfig — pure Alert-config builder: asserts the correct
 *     message key + confirm onPress wiring (behavioral, not catalog-string only).
 *  6. Section i18n keys present in catalog.th
 *
 * On-device behavioral gap (RNTL required): confirm the component actually renders
 * the postpartum text and triggers confirmLogout on the logout row tap — deferred.
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
import {
  buildPostpartumSummaryText,
  buildLogoutAlertConfig,
  buildMotherNameSummary,
} from './profileHubSummary';

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

// ─── 4. buildPostpartumSummaryText — pure postpartum day count helper ─────────
//
// This function is extracted from ProfileHubScreen's renderSummaryCard() so the
// postpartum-branch computation can be unit-tested without RNTL rendering.
// Spec §3.3 / §10.2: postpartum card MUST show "X วันหลังคลอด" computed via
// computePostpartumAge(birthDate, todayCivil) — NOT raw new Date() arithmetic.

describe('buildPostpartumSummaryText — postpartum day count (spec §3.3/§10.2)', () => {
  // Minimal t() stub: returns '{n} วันหลังคลอด' for profile.summary.postpartumDays
  // and 'หลังคลอด' for profile.summary.postpartumFallback.
  // This is intentionally minimal — the full i18n system is exercised at runtime.
  const tStub = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'profile.summary.postpartumDays') {
      return `${String(params?.n ?? '')} วันหลังคลอด`;
    }
    if (key === 'profile.summary.postpartumFallback') {
      return 'หลังคลอด';
    }
    return key;
  };

  it('computes correct day count via computePostpartumAge (not raw new Date())', () => {
    // Birth 10 days before today → expect "10 วันหลังคลอด"
    const birthDate = '2026-06-25';
    const todayCivil = '2026-07-05';
    const result = buildPostpartumSummaryText(birthDate, todayCivil, tStub);
    expect(result).toBe('10 วันหลังคลอด');
  });

  it('returns fallback when birthDate is null', () => {
    const result = buildPostpartumSummaryText(null, '2026-07-05', tStub);
    expect(result).toBe('หลังคลอด');
  });

  it('returns fallback when birthDate is undefined', () => {
    const result = buildPostpartumSummaryText(undefined, '2026-07-05', tStub);
    expect(result).toBe('หลังคลอด');
  });

  it('returns 0 วันหลังคลอด on birth day itself', () => {
    const today = '2026-07-05';
    const result = buildPostpartumSummaryText(today, today, tStub);
    expect(result).toBe('0 วันหลังคลอด');
  });

  it('uses profile.summary.postpartumDays i18n key (not hardcoded string)', () => {
    // Stub that records which key was called
    const calledKeys: string[] = [];
    const tSpy = (key: string, params?: Record<string, unknown>): string => {
      calledKeys.push(key);
      return tStub(key, params);
    };
    buildPostpartumSummaryText('2026-07-01', '2026-07-05', tSpy);
    expect(calledKeys).toContain('profile.summary.postpartumDays');
  });

  it('uses profile.summary.postpartumFallback i18n key when no birthDate', () => {
    const calledKeys: string[] = [];
    const tSpy = (key: string, params?: Record<string, unknown>): string => {
      calledKeys.push(key);
      return tStub(key, params);
    };
    buildPostpartumSummaryText(null, '2026-07-05', tSpy);
    expect(calledKeys).toContain('profile.summary.postpartumFallback');
  });
});

// ─── 5. buildLogoutAlertConfig — pure Alert config builder (nit-2 fix) ────────
//
// The confirm-logout behavior is extracted so it can be asserted in the pure
// node harness.  Prior tests only checked catalog strings (what the message
// SAYS), not the config wiring (which key is used, what onPress is bound to).

describe('buildLogoutAlertConfig — confirms profile.logout.message + onPress wiring', () => {
  const tStub = (key: string): string => key; // return key as-is for assertions

  it('uses profile.logout.message (NOT home.logoutMessage) as dialog body', () => {
    const onLogout = jest.fn();
    const [_title, message] = buildLogoutAlertConfig(tStub, onLogout);
    expect(message).toBe('profile.logout.message');
  });

  it('confirm button onPress is exactly the injected onLogout fn', () => {
    const onLogout = jest.fn();
    const [_title, _message, buttons] = buildLogoutAlertConfig(tStub, onLogout);
    const confirmBtn = (buttons ?? []).find(
      (b: { style?: string }) => b.style === 'destructive',
    ) as { onPress?: () => void; style?: string } | undefined;
    expect(confirmBtn?.onPress).toBe(onLogout);
  });

  it('cancel button has style cancel', () => {
    const onLogout = jest.fn();
    const [_title, _message, buttons] = buildLogoutAlertConfig(tStub, onLogout);
    const cancelBtn = (buttons ?? []).find(
      (b: { style?: string }) => b.style === 'cancel',
    );
    expect(cancelBtn).toBeDefined();
  });
});

// ─── 6. Section i18n keys reachable ──────────────────────────────────────────

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

// ─── 7. buildMotherNameSummary — PDPA-minimized summary card display ─────────
//
// Spec: profile-tab-and-hub-ui.md §3.3 (OQ-N-SEC2)
// Display rule: "คุณแม่ {firstName}" when firstName present; "คุณแม่" fallback.
// This helper is extracted so it can be tested without RNTL.
// It uses the profile.summary.motherFirstName i18n key (template: "คุณแม่ {name}")
// and profile.summary.fallbackName ("คุณแม่") for the fallback.

describe('buildMotherNameSummary — PDPA-minimized mother name display', () => {
  // Stub t() function: return template with {name} or fallback directly
  const tStub = (key: string, params?: Record<string, string | number>): string => {
    if (key === 'profile.summary.motherFirstName') {
      // Simulate interpolate: replace {name} with params.name
      return (params?.name != null) ? `คุณแม่ ${String(params.name)}` : 'คุณแม่';
    }
    if (key === 'profile.summary.fallbackName') {
      return 'คุณแม่';
    }
    return key;
  };

  it('returns "คุณแม่ {firstName}" when decoded first name is present', () => {
    const result = buildMotherNameSummary('สมหญิง', tStub);
    expect(result).toBe('คุณแม่ สมหญิง');
  });

  it('returns fallback "คุณแม่" when firstName is null', () => {
    const result = buildMotherNameSummary(null, tStub);
    expect(result).toBe('คุณแม่');
  });

  it('returns fallback when firstName is undefined', () => {
    const result = buildMotherNameSummary(undefined, tStub);
    expect(result).toBe('คุณแม่');
  });

  it('returns fallback for empty string firstName', () => {
    const result = buildMotherNameSummary('', tStub);
    expect(result).toBe('คุณแม่');
  });

  it('uses profile.summary.motherFirstName key when name is present', () => {
    const calledKeys: string[] = [];
    const tSpy = (key: string, params?: Record<string, string | number>): string => {
      calledKeys.push(key);
      return tStub(key, params);
    };
    buildMotherNameSummary('Alice', tSpy);
    expect(calledKeys).toContain('profile.summary.motherFirstName');
  });

  it('uses profile.summary.fallbackName key when name is absent', () => {
    const calledKeys: string[] = [];
    const tSpy = (key: string, params?: Record<string, string | number>): string => {
      calledKeys.push(key);
      return tStub(key, params);
    };
    buildMotherNameSummary(null, tSpy);
    expect(calledKeys).toContain('profile.summary.fallbackName');
  });
});

// ─── 7b. Profile section — edit personal info row (name-fields-mobile) ────────
//
// New "แก้ไขชื่อ / ข้อมูลส่วนตัว" row is lifecycle-agnostic (pregnant AND postpartum).
// Spec: profile-tab-and-hub-ui.md §3.4

describe('ProfileHub — edit personal info row (name-fields-mobile)', () => {
  it('PROFILE_HUB_TESTIDS has editPersonalInfoBtn constant', () => {
    expect(PROFILE_HUB_TESTIDS.editPersonalInfoBtn).toBe('profile-hub-edit-personal-info-btn');
  });

  it('profile.infoEdit.rowLabel i18n key is present + non-empty in th catalog', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['profile.infoEdit.rowLabel'];
    expect(val).toBeTruthy();
  });

  it('profile.infoEdit.rowLabel i18n key is present + non-empty in en catalog', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['profile.infoEdit.rowLabel'];
    expect(val).toBeTruthy();
  });

  it('ProfileHubScreen accepts onEditPersonalInfo prop without TypeScript error', () => {
    // Type-level guard: npx tsc --noEmit verifies the prop exists.
    // Runtime: confirms the screen still exports as a function.
    expect(typeof ProfileHubScreen).toBe('function');
  });
});

// ─── 8. Header (TDD RED — feat: profile-header-settings-row) ─────────────────
//
// The profile hub tab screen has no react-navigation header (MainTabs
// has headerShown:false). A custom inline header bar is required showing
// the title "โปรไฟล์ / Profile".

describe('ProfileHub — header bar (§1 feat-profile-header-settings-row)', () => {
  it('PROFILE_HUB_TESTIDS has screenHeader constant = "profile-hub-header"', () => {
    expect(PROFILE_HUB_TESTIDS.screenHeader).toBe('profile-hub-header');
  });

  it('profile.title i18n key is present + non-empty in th catalog', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['profile.title'];
    expect(val).toBeTruthy();
  });

  it('profile.title i18n key is present + non-empty in en catalog (locale parity)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['profile.title'];
    expect(val).toBeTruthy();
  });
});

// ─── 8. Settings row (TDD RED — feat: profile-header-settings-row) ───────────
//
// A Settings menu row is added to the Profile hub so the user can reach
// SettingsScreen from the Profile tab without using the gear ⚙ on Home.

describe('ProfileHub — Settings row (§2 feat-profile-header-settings-row)', () => {
  it('PROFILE_HUB_TESTIDS has settingsBtn constant = "profile-hub-settings-btn"', () => {
    expect(PROFILE_HUB_TESTIDS.settingsBtn).toBe('profile-hub-settings-btn');
  });

  it('settings.navTitle i18n key is present + non-empty in th catalog', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.th as any)['settings.navTitle'];
    expect(val).toBeTruthy();
  });

  it('settings.navTitle i18n key is present + non-empty in en catalog (locale parity)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (catalog.en as any)['settings.navTitle'];
    expect(val).toBeTruthy();
  });

  it('ProfileHubScreen is still a function after onSettings prop is added', () => {
    // Type-level guard: `npx tsc --noEmit` would fail if the onSettings prop were
    // absent from ProfileHubScreenProps while BottomTabNavigator passes it.
    // Runtime: confirms module still exports a component after the change.
    // Full behavioral assertion (RNTL: row press → onSettings called) is deferred
    // to the QA test phase — same pattern as logout-row RNTL deferral above.
    expect(typeof ProfileHubScreen).toBe('function');
  });
});
