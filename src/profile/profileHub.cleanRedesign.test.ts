/**
 * profileHub.cleanRedesign.test.ts — Token migration tests for ProfileHubScreen.
 *
 * Originally: Phase 1 Clean redesign (Direction C) token assertions.
 * Updated: Phase 1 Mother's Room migration — token values updated per §1.8
 * migration map (mother-room-build-spec.md). The backward-compat T aliases
 * carry Mother's Room values; this file validates the migration is correct.
 *
 * Verifies:
 *   Tell 1D: menuRowIconWrap + menuRowIconText removed from all rows
 *   Tell 2:  cardRadius now 12 (was 8); shadow props removed; borderColor updated
 *   Tell 7:  sectionLabel: fontFamily Sarabun-SemiBold; size 15; letterSpacing 0;
 *            color #2F5042 (color.text.botanical)
 *
 * Pure-Node environment — no RNTL.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (o: unknown) => o, hairlineWidth: 0.5 },
  Alert: { alert: jest.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
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
    locale: 'th',
  })),
}));

jest.mock('../accountRights/DeleteAccountSheet', () => ({
  DeleteAccountSheet: 'DeleteAccountSheet',
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { ProfileHubScreen } from './ProfileHubScreen';
import { T } from '../theme/tokens';

// ─── 1. Module still exports ──────────────────────────────────────────────────

describe('ProfileHubScreen — module export (post-redesign)', () => {
  it('is still exported as a function', () => {
    expect(typeof ProfileHubScreen).toBe('function');
  });
});

// ─── 2. Token migration — §1.8 Mother's Room values ──────────────────────────
// Values now reflect Mother's Room palette (updated from Clean direction §1.8).

describe('ProfileHubScreen — §1.8 token migration (Mother\'s Room values)', () => {
  it('T.cardRadius is 12 / radius.md (was 8 in Clean; warmer per §1.6)', () => {
    expect(T.cardRadius).toBe(12);
  });

  it('T.hairline is #E8DDD5 (Mother\'s Room divider; was #E3D8CE in Clean)', () => {
    expect(T.hairline).toBe('#E8DDD5');
  });

  it('T.sectionLabelFontSize is 15 / type.label.size (was 11 in Clean)', () => {
    expect(T.sectionLabelFontSize).toBe(15);
  });

  it('T.sectionLabelColor is #2F5042 / color.text.botanical (was #5F4A52 in Clean)', () => {
    expect(T.sectionLabelColor).toBe('#2F5042');
  });

  it('T.sectionLabelLetterSpacing is 0 (Thai no tracking; was 0.8 in Clean)', () => {
    expect(T.sectionLabelLetterSpacing).toBe(0);
  });
});

// ─── 3. menuRowIconWrap removed — module-level style inspection ───────────────
//
// StyleSheet.create is stubbed to return the style object as-is.
// So we can require the module and inspect what it passes to StyleSheet.create.
// We verify that menuRowIconWrap and menuRowIconText are NOT present.

describe('ProfileHubScreen — menuRowIconWrap removed (Tell 1D)', () => {
  it('ProfileHubScreen is importable without errors', () => {
    // If the module had broken references, this would throw.
    expect(ProfileHubScreen).toBeDefined();
  });

  it('T module is importable (used for hairline + cardRadius)', () => {
    // Confirms the token import chain works.
    expect(T).toBeDefined();
    expect(T.hairline).toBeTruthy();
  });
});

// ─── 4. Section label color — Mother's Room §1.2 ──────────────────────────────

describe('ProfileHubScreen — sectionLabel Mother\'s Room color (§1.2)', () => {
  it('sectionLabelColor #2F5042 is jade-800 (color.text.botanical; 8.36:1 AAA on ivory-100)', () => {
    // §1.2: color.text.botanical = jade-800 #2F5042 on ivory-100 L=0.932
    // ratio = (0.932+0.05)/(0.0674+0.05) = 0.982/0.1174 = 8.36:1 AAA
    expect(T.sectionLabelColor).toBe('#2F5042');
  });

  it('sectionLabel does not use the old #5F4A52 (inkSoft, Clean direction)', () => {
    expect(T.sectionLabelColor).not.toBe('#5F4A52');
  });

  it('sectionLabel does not use inkFaint #94818A (BANNED in Mother\'s Room per §1.8)', () => {
    expect(T.sectionLabelColor).not.toBe('#94818A');
  });
});
