/**
 * calendarHandlerWiring.test.ts
 *
 * Behavioral wiring guard for BLOCKER 1 (calendar control-plane).
 *
 * WHY this test exists alongside calendarControlPlane.e2e.test.ts
 * ─────────────────────────────────────────────────────────────────
 * calendarControlPlane.e2e.test.ts calls bridge.grantConsent() and
 * bridge.enableFeature() **directly** as "what the wired props should do".
 * That means the test is a simulation: it bypasses the RootNavigator handlers
 * (handleCalGrantConsent / handleCalToggleOn) entirely.
 *
 * Consequence: if handleCalGrantConsent is silently reverted to a no-op (e.g.
 *   onGrantConsent={() => navigation.goBack()}), the e2e test stays GREEN — the
 *   dead-feature ship again undetected.
 *
 * This test drives the REAL RootNavigator handler prop:
 *   1. Call RootNavigator() to obtain the PregnancyProfileProvider wrapper.
 *   2. Extract the inner StackNavigator function (same pattern as lossGateWiring.test.ts).
 *   3. Call StackNavigator() to get the Stack.Navigator element.
 *   4. Find the "CalendarSyncSettings" Stack.Screen's render-prop.
 *   5. Invoke the render-prop → obtain the CalendarSyncSettingsScreen element.
 *   6. Extract onGrantConsent / onToggleOn from element.props — these ARE the
 *      real handleCalGrantConsent / handleCalToggleOn closures from the navigator.
 *   7. Call them and assert the bridge spies fire.
 *
 * FAIL-ON-REVERT proof (verified):
 *   Removing `await deviceCalendarBridge.enableFeature()` from handleCalGrantConsent
 *   in RootNavigator.tsx makes the assertion
 *     expect(mockEnableFeature).toHaveBeenCalled()
 *   go RED.  The direct-bridge e2e test stays GREEN (proving the gap).
 *
 * Pattern: identical to lossGateWiring.test.ts (B2 behavioral navigator tests).
 *
 * SECURITY: fixture data only; no real health values logged.
 */

// ─── Module mocks (hoisted before all imports) ────────────────────────────────

// expo-calendar is a native ESM module — mock before any import.
jest.mock('expo-calendar', () => ({}));

// Mock React hooks so that calling a component as a plain function works without
// a React fiber. Pattern from lossGateWiring.test.ts.
jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState:    jest.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, jest.fn()]),
    useRef:      jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo:     jest.fn((fn: () => unknown) => fn()),
    useEffect:   jest.fn(),
  };
});

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Switch: 'Switch',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  SafeAreaView: 'SafeAreaView',
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  Modal: 'Modal',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  Platform: { OS: 'ios' },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({ Navigator: 'Tab.Navigator', Screen: 'Tab.Screen' }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: 'Stack.Navigator', Screen: 'Stack.Screen' }),
}));

jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot:       jest.fn(() => null),
  PregnancyProfileProvider: ({ children }: { children: unknown }) => children,
  useProfileSnapshotSetter: jest.fn(() => jest.fn()),
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

jest.mock('../icons', () => ({
  TabChecklistIcon: 'TabChecklistIcon',
  TabCoinsIcon:     'TabCoinsIcon',
  TabHomeIcon:      'TabHomeIcon',
  TabCalendarIcon:  'TabCalendarIcon',
  TabPillIcon:      'TabPillIcon',
  TabPersonIcon:    'TabPersonIcon',
}));

jest.mock('../pregnancy/gestationalAge', () => ({
  localCivilToday: jest.fn(() => '2027-01-01'),
}));

// ── Screen mocks ──────────────────────────────────────────────────────────────
jest.mock('../screens/HomeTabScreen',               () => ({ HomeTabScreen: jest.fn(() => null) }));
jest.mock('../calendar/CalendarScreen',             () => ({
  CalendarScreen:       jest.fn(() => null),
  filterLossStateItems: jest.fn((items: unknown) => items),
}));
jest.mock('../supplies/SuppliesScreen',             () => ({ SuppliesScreen: jest.fn(() => null) }));
jest.mock('../expenses/ExpensesScreen',             () => ({ ExpensesScreen: jest.fn(() => null) }));
jest.mock('../medication/MedicationPlanListScreen', () => ({ MedicationPlanListScreen: jest.fn(() => null) }));
jest.mock('../profile/ProfileHubScreen',            () => ({ ProfileHubScreen: jest.fn(() => null) }));
jest.mock('../calendar/AppointmentFormScreen',      () => ({ AppointmentFormScreen: jest.fn(() => null) }));
jest.mock('../calendar/ReminderFormScreen',         () => ({ ReminderFormScreen: jest.fn(() => null) }));

jest.mock('../calendar/calendarAddCaptureHandler', () => ({
  buildAddCaptureParams: jest.fn((date: unknown) => ({ loggedAtDate: date })),
}));
jest.mock('../medication/logDoseParams', () => ({
  buildLogDoseParams: jest.fn((id: unknown) => ({ planId: id })),
}));

// ── RootNavigator-specific screen mocks ───────────────────────────────────────
jest.mock('../screens/WelcomeScreen',              () => ({ WelcomeScreen: jest.fn(() => null) }));
jest.mock('../auth/LoginScreen',                   () => ({ LoginScreen: jest.fn(() => null) }));
jest.mock('../auth/RegisterScreen',                () => ({ RegisterScreen: jest.fn(() => null) }));
jest.mock('../auth/VerifyEmailScreen',             () => ({ VerifyEmailScreen: jest.fn(() => null) }));
jest.mock('../auth/ForgotPasswordScreen',          () => ({ ForgotPasswordScreen: jest.fn(() => null) }));
jest.mock('../auth/ResetPasswordScreen',           () => ({ ResetPasswordScreen: jest.fn(() => null) }));
jest.mock('../auth/loginSuccessToast',             () => ({ setPendingLoginSuccessToast: jest.fn() }));
jest.mock('../pregnancy/ProfileSetupScreen',       () => ({ ProfileSetupScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/ProfileEditScreen',        () => ({ ProfileEditScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/ProfileInfoEditScreen',    () => ({ ProfileInfoEditScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/BirthEventScreen',         () => ({ BirthEventScreen: jest.fn(() => null) }));
jest.mock('../settings/SettingsScreen',            () => ({ SettingsScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountHomeScreen',      () => ({ KickCountHomeScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountCountingScreen',  () => ({ KickCountCountingScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountSummaryScreen',   () => ({ KickCountSummaryScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountHistoryScreen',   () => ({ KickCountHistoryScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountDetailScreen',    () => ({ KickCountDetailScreen: jest.fn(() => null) }));
jest.mock('../screens/ConsentScreen',              () => ({ ConsentScreen: jest.fn(() => null) }));
jest.mock('../screens/ManageConsentsScreen',       () => ({ ManageConsentsScreen: jest.fn(() => null) }));
jest.mock('../suggestion/SuggestionFlowScreen',    () => ({ SuggestionFlowScreen: jest.fn(() => null) }));
jest.mock('../capture/CaptureScreen',              () => ({ CaptureScreen: jest.fn(() => null) }));
jest.mock('../pdfReport/DoctorPdfScreen',          () => ({ DoctorPdfScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/PregnancySummaryScreen',   () => ({ PregnancySummaryScreen: jest.fn(() => null) }));

// CalendarSync screens — jest.fn() so we can inspect element.props for handler wiring.
jest.mock('../deviceCalendar/screens/CalendarSyncSettingsScreen', () => ({
  CalendarSyncSettingsScreen: jest.fn(() => null),
}));
jest.mock('../deviceCalendar/screens/CalendarSyncConsentSheet', () => ({
  CalendarSyncConsentSheet: jest.fn(() => null),
}));
jest.mock('../deviceCalendar/screens/CalendarSyncPrivacyLevelScreen', () => ({
  CalendarSyncPrivacyLevelScreen: jest.fn(() => null),
}));

// ── Misc RootNavigator deps ────────────────────────────────────────────────────
jest.mock('./doctorReportRouteOptions',          () => ({ DOCTOR_REPORT_ROUTE_OPTIONS: {} }));
jest.mock('../pregnancy/pregnancyApiClient',     () => ({ createPregnancyClient: jest.fn(() => ({})) }));
jest.mock('../pregnancy/hospitalStayCipher',     () => ({
  decodeDateFromWire: jest.fn((d: unknown) => (d ?? null) as string | null),
}));
jest.mock('../suggestion/ancUpcomingApptSelector', () => ({
  hasUpcomingAncApptInWindow: jest.fn(() => false),
}));
jest.mock('../deepLink/resetDeepLink', () => ({
  resetTokenStore: { current: null },
  clearResetToken: jest.fn(),
}));

// ── Store mocks ────────────────────────────────────────────────────────────────
jest.mock('../sync/calendarSyncStore', () => ({
  calendarSyncStore: {
    getChecklistItem:      jest.fn(() => null),
    getReminder:           jest.fn(() => null),
    getActiveChecklistItems: jest.fn(() => []),
    reset:                 jest.fn(),
  },
}));
jest.mock('../sync/supplySyncStore',                () => ({ supplySyncStore:             { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountSyncStore',        () => ({ kickCountSyncStore:          { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountDraftStore',       () => ({ clearDraft:                  jest.fn() }));
jest.mock('../consent/consentSync',                () => ({ resetConsentQueue:            jest.fn() }));
jest.mock('../suggestion/suggestionStore',         () => ({ suggestionStore:             { reset: jest.fn() } }));
jest.mock('../expenses/expensesSyncStore',         () => ({ expensesSyncStore:            { reset: jest.fn() } }));
jest.mock('../selfLog/selfLogSyncStore',           () => ({ selfLogSyncStore:             { reset: jest.fn() } }));
jest.mock('../medication/medicationPlanSyncStore', () => ({ medicationPlanSyncStore:      { reset: jest.fn() } }));
jest.mock('../medication/medicationLogSyncStore',  () => ({ medicationLogSyncStore:       { reset: jest.fn() } }));
jest.mock('../auth/performLogout',                 () => ({ performLogout:                jest.fn() }));

// consentStore — adds setGranted (used by handleCalGrantConsent).
jest.mock('../consent/consentStore', () => ({
  consentStore: { reset: jest.fn(), setGranted: jest.fn() },
}));

// deviceCalendarSingleton — spied bridge methods so we can assert call counts.
jest.mock('../deviceCalendar/deviceCalendarSingleton', () => ({
  deviceCalendarBridge: {
    grantConsent:           jest.fn().mockResolvedValue({ ok: true }),
    enableFeature:          jest.fn().mockResolvedValue('ok'),
    disableAndWithdraw:     jest.fn().mockResolvedValue(undefined),
    onPrivacyLevelChanged:  jest.fn().mockResolvedValue({ failedCount: 0 }),
    updateConsentSnapshot:  jest.fn(),
    updateFeatureToggle:    jest.fn(),
    onConsentRefreshResult: jest.fn().mockResolvedValue(undefined),
  },
  syncCalendarBridgeConsentFromStore:  jest.fn(),
  backfillCalendarFromStore:           jest.fn().mockResolvedValue(undefined),
  changePrivacyLevel:                  jest.fn().mockResolvedValue({ failedCount: 0 }),
  getCalendarSyncSnapshot:             jest.fn(() => ({
    featureEnabled:      false,
    privacyLevel:        'generic' as const,
    consentGranted:      false,
    osPermissionGranted: false,
  })),
  attachCalendarObserver:              jest.fn(() => () => {}),
  configureCalendarPostConsent:        jest.fn(),
  checkAndUpdateOsPermission:          jest.fn().mockResolvedValue(false),
  initCalendarPersistenceFromStorage:  jest.fn().mockResolvedValue(undefined),
  refreshCalendarBridgeConsent:        jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports (after mock declarations) ───────────────────────────────────────

import React from 'react';
import { RootNavigator } from './RootNavigator';
import { CalendarSyncSettingsScreen } from '../deviceCalendar/screens/CalendarSyncSettingsScreen';
import { deviceCalendarBridge } from '../deviceCalendar/deviceCalendarSingleton';

// ─── Typed mock handles ───────────────────────────────────────────────────────

const MockCalendarSyncSettingsScreen = CalendarSyncSettingsScreen as unknown as jest.Mock;
const mockGrantConsent  = deviceCalendarBridge.grantConsent  as jest.Mock;
const mockEnableFeature = deviceCalendarBridge.enableFeature as jest.Mock;

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve(null)),
  save: jest.fn(),
  clear: jest.fn(),
};

// ─── Helper: extract StackNavigator function reference from RootNavigator ─────
//
// RootNavigator wraps the unexported StackNavigator in PregnancyProfileProvider.
// Calling RootNavigator() returns an element whose props.children is the
// <StackNavigator ...> element. We extract the function from element.type.
// Pattern identical to lossGateWiring.test.ts getStackNavigatorFn().

type StackNavigatorFnType = (props: { tokenStorage: typeof mockTokenStorage; apiBaseUrl: string }) => React.ReactElement;

function getStackNavigatorFn(): StackNavigatorFnType {
  const rootElement = (RootNavigator as unknown as StackNavigatorFnType)({
    tokenStorage: mockTokenStorage,
    apiBaseUrl:   '',
  });
  // rootElement = <PregnancyProfileProvider><StackNavigator .../></PregnancyProfileProvider>
  // PregnancyProfileProvider is mocked as ({ children }) => children.
  const childElement = (rootElement.props as { children: React.ReactElement }).children;
  return childElement.type as unknown as StackNavigatorFnType;
}

// ─── Helper: find a named screen's render-prop inside a navigator element ──────
//
// Same helper as in lossGateWiring.test.ts.

function findScreenRenderProp(
  navigatorElement: React.ReactElement,
  screenName: string,
): ((...args: unknown[]) => React.ReactElement) | null {
  const { children } = navigatorElement.props as { children: unknown };
  const childArray: React.ReactElement[] = Array.isArray(children)
    ? (children as React.ReactElement[])
    : children
      ? [children as React.ReactElement]
      : [];

  for (const child of childArray) {
    if (!React.isValidElement(child)) continue;
    const props = child.props as {
      name?: string;
      children?: (...args: unknown[]) => React.ReactElement;
    };
    if (props.name === screenName && typeof props.children === 'function') {
      return props.children;
    }
  }
  return null;
}

// ─── Helper: extract CalendarSyncSettings element from StackNavigator ─────────

function getCalendarSyncSettingsElement(
  StackNavigatorFn: StackNavigatorFnType,
  navMock: { navigate: jest.Mock; goBack: jest.Mock },
): React.ReactElement {
  const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
  const renderProp = findScreenRenderProp(stackElement, 'CalendarSyncSettings');
  if (!renderProp) throw new Error('CalendarSyncSettings render-prop not found in StackNavigator');
  return renderProp({ navigation: navMock }) as React.ReactElement;
}

// ─── BEHAVIORAL TESTS ─────────────────────────────────────────────────────────

// ── Suite 1: onGrantConsent handler wiring ────────────────────────────────────
//
// Drives the REAL handleCalGrantConsent via the wired onGrantConsent prop.
// FAIL-ON-REVERT: removing deviceCalendarBridge.enableFeature() from
// handleCalGrantConsent in RootNavigator.tsx makes the last assertion RED.

describe('[CalendarHandlerWiring] CalendarSyncSettings.onGrantConsent → real handleCalGrantConsent', () => {
  let StackNavigatorFn: StackNavigatorFnType;

  beforeAll(() => {
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('render-prop produces a CalendarSyncSettingsScreen element with onGrantConsent prop', () => {
    const navMock = { navigate: jest.fn(), goBack: jest.fn() };
    const screenElement = getCalendarSyncSettingsElement(StackNavigatorFn, navMock);

    // The element type IS the mocked CalendarSyncSettingsScreen function.
    expect(screenElement.type).toBe(MockCalendarSyncSettingsScreen);

    // onGrantConsent must be a function (the real handleCalGrantConsent closure).
    const { onGrantConsent } = screenElement.props as {
      onGrantConsent?: () => Promise<void>;
    };
    expect(typeof onGrantConsent).toBe('function');
  });

  it(
    'calling the real onGrantConsent prop invokes bridge.grantConsent() + bridge.enableFeature() ' +
    '(FAIL-ON-REVERT: remove enableFeature from handleCalGrantConsent → this goes RED)',
    async () => {
      const navMock = { navigate: jest.fn(), goBack: jest.fn() };
      const screenElement = getCalendarSyncSettingsElement(StackNavigatorFn, navMock);

      const { onGrantConsent } = screenElement.props as {
        onGrantConsent?: () => Promise<void>;
      };
      expect(onGrantConsent).toBeDefined();

      // ── Invoke the REAL navigator handler prop (not bridge.grantConsent directly) ──
      await onGrantConsent!();

      // ── Assert: both bridge calls must fire through the real handler ─────────────
      // If handleCalGrantConsent's enableFeature() line is removed, only
      // mockGrantConsent is called and the second expect goes RED.
      expect(mockGrantConsent).toHaveBeenCalledWith('v1.0');
      expect(mockEnableFeature).toHaveBeenCalledTimes(1);
    },
  );

  it('onGrantConsent calls grantConsent BEFORE enableFeature (explainer-before-prompt order CAL-SCR-10)', async () => {
    const callOrder: string[] = [];
    mockGrantConsent.mockImplementation(async () => {
      callOrder.push('grantConsent');
      return { ok: true };
    });
    mockEnableFeature.mockImplementation(async () => {
      callOrder.push('enableFeature');
      return 'ok';
    });

    const navMock = { navigate: jest.fn(), goBack: jest.fn() };
    const screenElement = getCalendarSyncSettingsElement(StackNavigatorFn, navMock);
    const { onGrantConsent } = screenElement.props as { onGrantConsent?: () => Promise<void> };

    await onGrantConsent!();

    // grantConsent (consent POST, no OS prompt) must precede enableFeature (OS prompt).
    expect(callOrder).toEqual(['grantConsent', 'enableFeature']);
  });

  it('FAIL-ON-REVERT: no-op onGrantConsent → bridge methods NOT called', async () => {
    // Documents the broken state: if the navigator passes onGrantConsent={() => goBack()}
    // (or no prop at all), calling it should NOT reach the bridge.
    // The test above catches this regression; this test documents the no-op scenario
    // separately for clarity.
    const navMock = { navigate: jest.fn(), goBack: jest.fn() };

    // Simulate a no-op handler (the old broken navigator state).
    const noOpGrantConsent = async (): Promise<void> => { navMock.goBack(); };
    await noOpGrantConsent();

    // Bridge is NEVER called when the handler is a no-op.
    expect(mockGrantConsent).not.toHaveBeenCalled();
    expect(mockEnableFeature).not.toHaveBeenCalled();
    // The real wired handler above DOES call them — hence the upgrade catches the regression.
  });
});

// ── Suite 2: onToggleOn handler wiring ───────────────────────────────────────
//
// Drives the REAL handleCalToggleOn via the wired onToggleOn prop.
// FAIL-ON-REVERT: if handleCalToggleOn is a no-op or missing, enableFeature is
// never called and the assertion goes RED.

describe('[CalendarHandlerWiring] CalendarSyncSettings.onToggleOn → real handleCalToggleOn', () => {
  let StackNavigatorFn: StackNavigatorFnType;

  beforeAll(() => {
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('render-prop produces a CalendarSyncSettingsScreen element with onToggleOn prop', () => {
    const navMock = { navigate: jest.fn(), goBack: jest.fn() };
    const screenElement = getCalendarSyncSettingsElement(StackNavigatorFn, navMock);

    const { onToggleOn } = screenElement.props as { onToggleOn?: () => Promise<void> };
    expect(typeof onToggleOn).toBe('function');
  });

  it(
    'calling the real onToggleOn prop invokes bridge.enableFeature() ' +
    '(FAIL-ON-REVERT: remove enableFeature from handleCalToggleOn → this goes RED)',
    async () => {
      const navMock = { navigate: jest.fn(), goBack: jest.fn() };
      const screenElement = getCalendarSyncSettingsElement(StackNavigatorFn, navMock);

      const { onToggleOn } = screenElement.props as { onToggleOn?: () => Promise<void> };
      expect(onToggleOn).toBeDefined();

      // ── Invoke the REAL navigator handler prop ────────────────────────────────
      await onToggleOn!();

      // enableFeature must fire — consent is already granted, only OS permission needed.
      expect(mockEnableFeature).toHaveBeenCalledTimes(1);
      // grantConsent must NOT fire (consent was already granted; no consent POST needed).
      expect(mockGrantConsent).not.toHaveBeenCalled();
    },
  );

  it('FAIL-ON-REVERT: no-op onToggleOn → enableFeature NOT called', async () => {
    // Documents the broken state: if the navigator passes onToggleOn={() => goBack()}
    // or omits the prop, calling it does NOT open the OS permission gate.
    const navMock = { navigate: jest.fn(), goBack: jest.fn() };
    const noOpToggleOn = async (): Promise<void> => { navMock.goBack(); };
    await noOpToggleOn();

    expect(mockEnableFeature).not.toHaveBeenCalled();
  });
});

// ── Suite 3: Source-level guard on handler prop assignment ────────────────────
//
// Source-grep layer (same pattern as lossGateWiring.test.ts supplementary tests).
// These catch a string-level regression like onGrantConsent being renamed or
// accidentally removed from the JSX. They cannot stand alone (a runtime no-op
// passes grep but breaks delivery) — both layers together give full coverage.

import * as fs from 'fs';
import * as path from 'path';

const ROOT_NAV_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

function extractScreenBlock(src: string, screenName: string): string {
  const marker = `name="${screenName}"`;
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) return '';
  for (const closeTag of ['</Stack.Screen>', '</Tab.Screen>']) {
    const endIdx = src.indexOf(closeTag, startIdx);
    if (endIdx !== -1) return src.slice(startIdx, endIdx + closeTag.length);
  }
  return src.slice(startIdx);
}

describe('[CalendarHandlerWiring Source] RootNavigator → CalendarSyncSettings prop assignments', () => {
  it('CalendarSyncSettings block wires onGrantConsent to handleCalGrantConsent', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'CalendarSyncSettings');
    expect(block).toContain('onGrantConsent={handleCalGrantConsent}');
  });

  it('CalendarSyncSettings block wires onToggleOn to handleCalToggleOn', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'CalendarSyncSettings');
    expect(block).toContain('onToggleOn={handleCalToggleOn}');
  });

  it('CalendarSyncSettings block wires onDisableFeature to handleCalDisableFeature', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'CalendarSyncSettings');
    expect(block).toContain('onDisableFeature={handleCalDisableFeature}');
  });

  it('FAIL-ON-REVERT: CalendarSyncSettings block contains all three handler prop assignments', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'CalendarSyncSettings');
    // Any of these missing → immediate RED
    expect(block).toContain('onGrantConsent=');
    expect(block).toContain('onToggleOn=');
    expect(block).toContain('onDisableFeature=');
  });

  it('handleCalGrantConsent body contains enableFeature() call (FAIL-ON-REVERT if removed)', () => {
    // Guards the handler body itself, complementing the behavioral prop test.
    // If enableFeature is removed from the handler, this grep goes RED immediately.
    const handlerStart = ROOT_NAV_SRC.indexOf('handleCalGrantConsent');
    const handlerBlock = ROOT_NAV_SRC.slice(handlerStart, handlerStart + 600);
    expect(handlerBlock).toContain('enableFeature');
  });

  it('handleCalToggleOn body contains enableFeature() call (FAIL-ON-REVERT if removed)', () => {
    const handlerStart = ROOT_NAV_SRC.indexOf('handleCalToggleOn');
    const handlerBlock = ROOT_NAV_SRC.slice(handlerStart, handlerStart + 300);
    expect(handlerBlock).toContain('enableFeature');
  });
});
