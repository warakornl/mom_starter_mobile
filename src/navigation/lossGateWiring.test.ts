/**
 * lossGateWiring.test.ts — TDD guard for B2 navigator-level loss-gate wiring.
 *
 * ─── Behavioral tests (primary) ───────────────────────────────────────────────
 * Each describe block mocks `useProfileSnapshot`, calls the navigator function
 * directly (same pattern as resetPasswordScreen.motherRoom.test.tsx and
 * profileSetupScreen.motherRoom.test.tsx), extracts the target screen's
 * render-prop, invokes it, and asserts the `lifecycle` value present in the
 * resulting React element's props — without a NavigationContainer or RNTL.
 *
 * This proves the BINDING at runtime, not just as a string in source:
 *   - 'ended' snapshot  → element.props.lifecycle === 'ended'
 *   - null snapshot     → element.props.lifecycle === undefined (NOT 'pregnant') [GAP-2]
 *
 * Fail-on-revert: removing `lifecycle={snapshot?.lifecycle}` from any wired
 * site makes the corresponding 'ended'-case assertion go RED — the child element
 * no longer carries the prop.
 *
 * ─── Source-grep tests (supplementary) ────────────────────────────────────────
 * Kept as an additional guard against string-level regressions (e.g. the wrong
 * variable name). They cannot stand alone (a rename of `snapshot` while keeping
 * the string passes grep but breaks delivery). Both layers together give full
 * coverage.
 *
 * ─── Wired sites covered ──────────────────────────────────────────────────────
 *   A. BottomTabNavigator → CalendarScreen          (behavioral + grep)
 *   B. StackNavigator    → AppointmentFormScreen    (behavioral + grep)
 *   C. StackNavigator    → ReminderFormScreen       (behavioral + grep)
 *   D. StackNavigator    → AncAppointmentForm (AppointmentFormScreen) (behavioral + grep)
 *   E. CalendarScreen    — kickCountItems loss gate (source-grep only, unit-tested elsewhere)
 */

// ─── Module mocks (hoisted before all imports) ────────────────────────────────
// Mocking strategy: match the pattern in resetPasswordScreen.motherRoom.test.tsx
// and profileSetupScreen.motherRoom.test.tsx — mock React hooks so that calling
// a component as a plain function works without a React fiber.

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => [init, jest.fn()]),
    useRef: jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((fn: () => unknown) => fn()),
    useEffect: jest.fn(),
  };
});

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  SafeAreaView: 'SafeAreaView',
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  Modal: 'Modal',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
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

// The key mock: controls what useProfileSnapshot returns in each test.
jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot: jest.fn(),
  PregnancyProfileProvider: ({ children }: { children: unknown }) => children,
  useProfileSnapshotSetter: jest.fn(() => jest.fn()),
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

// Icons: SVG imports must not fail in Node.
jest.mock('../icons', () => ({
  TabChecklistIcon: 'TabChecklistIcon',
  TabCoinsIcon: 'TabCoinsIcon',
  TabHomeIcon: 'TabHomeIcon',
  TabCalendarIcon: 'TabCalendarIcon',
  TabPillIcon: 'TabPillIcon',
  TabPersonIcon: 'TabPersonIcon',
}));

jest.mock('../pregnancy/gestationalAge', () => ({
  localCivilToday: jest.fn(() => '2024-01-01'),
}));

// ── Screen mocks — jest.fn() so element.type can be compared ──────────────────
jest.mock('../screens/HomeTabScreen', () => ({ HomeTabScreen: jest.fn(() => null) }));
jest.mock('../calendar/CalendarScreen', () => ({
  CalendarScreen: jest.fn(() => null),
  filterLossStateItems: jest.fn((items: unknown) => items),
}));
jest.mock('../supplies/SuppliesScreen', () => ({ SuppliesScreen: jest.fn(() => null) }));
jest.mock('../expenses/ExpensesScreen', () => ({ ExpensesScreen: jest.fn(() => null) }));
jest.mock('../medication/MedicationPlanListScreen', () => ({ MedicationPlanListScreen: jest.fn(() => null) }));
jest.mock('../profile/ProfileHubScreen', () => ({ ProfileHubScreen: jest.fn(() => null) }));
jest.mock('../calendar/AppointmentFormScreen', () => ({ AppointmentFormScreen: jest.fn(() => null) }));
jest.mock('../calendar/ReminderFormScreen', () => ({ ReminderFormScreen: jest.fn(() => null) }));

jest.mock('../calendar/calendarAddCaptureHandler', () => ({
  buildAddCaptureParams: jest.fn((date: unknown) => ({ loggedAtDate: date })),
}));
jest.mock('../medication/logDoseParams', () => ({
  buildLogDoseParams: jest.fn((id: unknown) => ({ planId: id })),
}));

// ── Store mocks ────────────────────────────────────────────────────────────────
jest.mock('../sync/calendarSyncStore', () => ({
  calendarSyncStore: {
    getChecklistItem: jest.fn(() => null),
    getReminder: jest.fn(() => null),
    getActiveChecklistItems: jest.fn(() => []),
    reset: jest.fn(),
  },
}));
jest.mock('../sync/supplySyncStore', () => ({ supplySyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountSyncStore', () => ({ kickCountSyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountDraftStore', () => ({ clearDraft: jest.fn() }));
jest.mock('../consent/consentStore', () => ({ consentStore: { reset: jest.fn() } }));
jest.mock('../consent/consentSync', () => ({ resetConsentQueue: jest.fn() }));
jest.mock('../suggestion/suggestionStore', () => ({ suggestionStore: { reset: jest.fn() } }));
jest.mock('../expenses/expensesSyncStore', () => ({ expensesSyncStore: { reset: jest.fn() } }));
jest.mock('../selfLog/selfLogSyncStore', () => ({ selfLogSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationPlanSyncStore', () => ({ medicationPlanSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationLogSyncStore', () => ({ medicationLogSyncStore: { reset: jest.fn() } }));
jest.mock('../auth/performLogout', () => ({ performLogout: jest.fn() }));

// ── RootNavigator-specific screen mocks ───────────────────────────────────────
jest.mock('../screens/WelcomeScreen', () => ({ WelcomeScreen: jest.fn(() => null) }));
jest.mock('../auth/LoginScreen', () => ({ LoginScreen: jest.fn(() => null) }));
jest.mock('../auth/RegisterScreen', () => ({ RegisterScreen: jest.fn(() => null) }));
jest.mock('../auth/VerifyEmailScreen', () => ({ VerifyEmailScreen: jest.fn(() => null) }));
jest.mock('../auth/ForgotPasswordScreen', () => ({ ForgotPasswordScreen: jest.fn(() => null) }));
jest.mock('../auth/ResetPasswordScreen', () => ({ ResetPasswordScreen: jest.fn(() => null) }));
jest.mock('../auth/loginSuccessToast', () => ({ setPendingLoginSuccessToast: jest.fn() }));
jest.mock('../pregnancy/ProfileSetupScreen', () => ({ ProfileSetupScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/ProfileEditScreen', () => ({ ProfileEditScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/ProfileInfoEditScreen', () => ({ ProfileInfoEditScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/BirthEventScreen', () => ({ BirthEventScreen: jest.fn(() => null) }));
jest.mock('../settings/SettingsScreen', () => ({ SettingsScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountHomeScreen', () => ({ KickCountHomeScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountCountingScreen', () => ({ KickCountCountingScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountSummaryScreen', () => ({ KickCountSummaryScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountHistoryScreen', () => ({ KickCountHistoryScreen: jest.fn(() => null) }));
jest.mock('../kickCount/KickCountDetailScreen', () => ({ KickCountDetailScreen: jest.fn(() => null) }));
jest.mock('../deepLink/resetDeepLink', () => ({
  resetTokenStore: { current: null },
  clearResetToken: jest.fn(),
}));
jest.mock('../screens/ConsentScreen', () => ({ ConsentScreen: jest.fn(() => null) }));
jest.mock('../screens/ManageConsentsScreen', () => ({ ManageConsentsScreen: jest.fn(() => null) }));
jest.mock('../suggestion/SuggestionFlowScreen', () => ({ SuggestionFlowScreen: jest.fn(() => null) }));
jest.mock('../capture/CaptureScreen', () => ({ CaptureScreen: jest.fn(() => null) }));
jest.mock('../pdfReport/DoctorPdfScreen', () => ({ DoctorPdfScreen: jest.fn(() => null) }));
jest.mock('../pregnancy/PregnancySummaryScreen', () => ({ PregnancySummaryScreen: jest.fn(() => null) }));
jest.mock('./doctorReportRouteOptions', () => ({ DOCTOR_REPORT_ROUTE_OPTIONS: {} }));
jest.mock('../pregnancy/pregnancyApiClient', () => ({ createPregnancyClient: jest.fn(() => ({})) }));
jest.mock('../pregnancy/hospitalStayCipher', () => ({
  decodeDateFromWire: jest.fn((d: unknown) => (d ?? null) as string | null),
}));
jest.mock('../suggestion/ancUpcomingApptSelector', () => ({
  hasUpcomingAncApptInWindow: jest.fn(() => false),
}));

// expo-calendar is a native ESM module that cannot run in Node/Jest.
// deviceCalendarSingleton transitively imports it via expoCalendarGateway.
// Mock the entire singleton so navigation tests don't hit native imports.
jest.mock('expo-calendar', () => ({}));
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
    privacyLevel:        'generic',
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

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { BottomTabNavigator, type BottomTabNavigatorProps } from './BottomTabNavigator';
import { RootNavigator } from './RootNavigator';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { AppointmentFormScreen } from '../calendar/AppointmentFormScreen';
import { ReminderFormScreen } from '../calendar/ReminderFormScreen';
import { KickCountHomeScreen } from '../kickCount/KickCountHomeScreen';
import { useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';

// ─── Typed mock handles ───────────────────────────────────────────────────────

const mockUseProfileSnapshot = useProfileSnapshot as unknown as jest.Mock;
const MockCalendarScreen     = CalendarScreen as unknown as jest.Mock;
const MockAppointmentForm    = AppointmentFormScreen as unknown as jest.Mock;
const MockReminderForm       = ReminderFormScreen as unknown as jest.Mock;
const MockKickCountHome      = KickCountHomeScreen as unknown as jest.Mock;

// ─── Shared test fixtures ─────────────────────────────────────────────────────

/** A minimal ProfileSnapshot with lifecycle='ended'. */
const ENDED_SNAPSHOT = {
  lifecycle: 'ended' as const,
  gestationalWeek: 0,
  edd: '2024-01-01',
  todayCivil: '2024-01-01',
  generalHealthConsented: false,
};

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve(null)),
  save: jest.fn(),
  clear: jest.fn(),
};

/** Minimal root-stack navigation prop passed to BottomTabNavigator. */
const mockRootNavigation = {
  navigate: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
} as unknown as BottomTabNavigatorProps['navigation'];

// ─── Helper: find a named screen's render-prop inside a navigator element ──────

/**
 * Traverses the direct children of a Navigator element and returns the
 * `children` render-prop (or component prop) of the Screen named `screenName`.
 *
 * Works for both Tab.Screen and Stack.Screen since both are mocked as plain
 * string element types, so the shape is { name, children } or { name, component }.
 */
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
    const props = child.props as { name?: string; children?: (...args: unknown[]) => React.ReactElement };
    if (props.name === screenName && typeof props.children === 'function') {
      return props.children;
    }
  }
  return null;
}

// ─── Helper: extract StackNavigator function reference from RootNavigator ─────
//
// RootNavigator (exported) wraps the unexported StackNavigator in
// PregnancyProfileProvider. Calling RootNavigator() returns an element whose
// props.children is the <StackNavigator ...> element. We extract the function
// reference from element.type so we can call StackNavigator directly.

type NavigatorFn = (props: { tokenStorage: typeof mockTokenStorage; apiBaseUrl: string }) => React.ReactElement;

function getStackNavigatorFn(): NavigatorFn {
  const rootElement = (RootNavigator as unknown as NavigatorFn)({
    tokenStorage: mockTokenStorage,
    apiBaseUrl: '',
  });
  // rootElement = <PregnancyProfileProvider><StackNavigator .../></PregnancyProfileProvider>
  // PregnancyProfileProvider is mocked as ({ children }) => children, so the element
  // structure is: { type: MockPregnancyProfileProvider, props: { children: <StackNavigator .../> } }
  const childElement = (rootElement.props as { children: React.ReactElement }).children;
  return childElement.type as unknown as NavigatorFn;
}

// ─── BEHAVIORAL TESTS ─────────────────────────────────────────────────────────
//
// These tests EXECUTE the real binding code `snapshot?.lifecycle` by calling
// the navigator function directly, extracting the render-prop closure, invoking
// it, and inspecting the resulting React element's props.
//
// The key properties under test:
//   1. 'ended' snapshot  → child element receives lifecycle: 'ended'
//   2. null snapshot     → child element receives lifecycle: undefined  (NOT 'pregnant', GAP-2)
//   3. Fail-on-revert    → if lifecycle={snapshot?.lifecycle} is removed from the navigator,
//                          the 'ended' case assertion goes RED.

// ── A. BottomTabNavigator → CalendarScreen ────────────────────────────────────

describe('[B2 Behavioral] BottomTabNavigator → CalendarScreen prop-flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('render-prop delivers lifecycle:"ended" to CalendarScreen when snapshot.lifecycle="ended"', () => {
    // Arrange: snapshot is 'ended'
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    // Act: call the navigator as a plain function (no fiber needed; hooks are mocked)
    const tabNavElement = (BottomTabNavigator as unknown as (p: BottomTabNavigatorProps) => React.ReactElement)({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: '',
      navigation: mockRootNavigation,
    });

    // The tabNavElement is <Tab.Navigator ...>...<Tab.Screen name="Calendar">{fn}</Tab.Screen>...</Tab.Navigator>
    const calendarRenderProp = findScreenRenderProp(tabNavElement, 'Calendar');
    expect(calendarRenderProp).not.toBeNull();

    // Act: invoke the render-prop — this evaluates the real binding: snapshot?.lifecycle
    const calElement = calendarRenderProp!();

    // Assert: the element created for CalendarScreen carries lifecycle: 'ended'
    expect(calElement.type).toBe(MockCalendarScreen);
    expect((calElement.props as Record<string, unknown>).lifecycle).toBe('ended');
  });

  it('render-prop delivers lifecycle:undefined when snapshot is null — proves GAP-2 (NOT "pregnant")', () => {
    // Arrange: snapshot is null (profile not yet loaded)
    mockUseProfileSnapshot.mockReturnValue(null);

    const tabNavElement = (BottomTabNavigator as unknown as (p: BottomTabNavigatorProps) => React.ReactElement)({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: '',
      navigation: mockRootNavigation,
    });

    const calendarRenderProp = findScreenRenderProp(tabNavElement, 'Calendar');
    expect(calendarRenderProp).not.toBeNull();

    const calElement = calendarRenderProp!();

    // GAP-2: snapshot?.lifecycle must be undefined, NOT the 'pregnant' default
    // that _kickProps would produce. The navigator correctly uses snapshot?.lifecycle.
    expect((calElement.props as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((calElement.props as Record<string, unknown>).lifecycle).not.toBe('pregnant');
  });

  /**
   * FAIL-ON-REVERT proof: this test documents what goes RED when
   * `lifecycle={snapshot?.lifecycle}` is removed from the Calendar Tab.Screen.
   *
   * Without the prop, element.props.lifecycle is undefined even for an ended
   * snapshot — the 'ended' assertion above would fail with:
   *   expect(received).toBe(expected) → undefined ≠ 'ended'
   *
   * Verified manually: temporarily removing lifecycle={snapshot?.lifecycle} from
   * BottomTabNavigator.tsx Calendar Tab.Screen → the 'ended' test above turned RED.
   * The prop was restored before committing.
   */
  it('FAIL-ON-REVERT: CalendarScreen element carries a lifecycle prop (guards the wiring site)', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const tabNavElement = (BottomTabNavigator as unknown as (p: BottomTabNavigatorProps) => React.ReactElement)({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: '',
      navigation: mockRootNavigation,
    });

    const calendarRenderProp = findScreenRenderProp(tabNavElement, 'Calendar');
    const calElement = calendarRenderProp!();

    // This assertion goes RED the moment lifecycle= is removed from the navigator.
    expect(Object.keys(calElement.props as object)).toContain('lifecycle');
  });
});

// ── B. StackNavigator → AppointmentFormScreen ────────────────────────────────

describe('[B2 Behavioral] StackNavigator → AppointmentFormScreen prop-flow', () => {
  let StackNavigatorFn: NavigatorFn;

  beforeAll(() => {
    // StackNavigator is an unexported inner function.  We extract its reference
    // from the element produced by RootNavigator().  This is stable across tests.
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AppointmentForm render-prop delivers lifecycle:"ended" to AppointmentFormScreen', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'AppointmentForm');
    expect(renderProp).not.toBeNull();

    // The AppointmentForm render-prop signature: ({ route, navigation }) => ...
    const apptElement = renderProp!({
      route: { params: {} },
      navigation: { goBack: jest.fn() },
    });

    expect(apptElement.type).toBe(MockAppointmentForm);
    expect((apptElement.props as Record<string, unknown>).lifecycle).toBe('ended');
  });

  it('AppointmentForm render-prop delivers lifecycle:undefined when snapshot is null (GAP-2)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'AppointmentForm');
    const apptElement = renderProp!({
      route: { params: {} },
      navigation: { goBack: jest.fn() },
    });

    expect((apptElement.props as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((apptElement.props as Record<string, unknown>).lifecycle).not.toBe('pregnant');
  });

  it('FAIL-ON-REVERT: AppointmentFormScreen element carries a lifecycle prop', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'AppointmentForm');
    const apptElement = renderProp!({ route: { params: {} }, navigation: { goBack: jest.fn() } });

    expect(Object.keys(apptElement.props as object)).toContain('lifecycle');
  });
});

// ── C. StackNavigator → ReminderFormScreen ───────────────────────────────────

describe('[B2 Behavioral] StackNavigator → ReminderFormScreen prop-flow', () => {
  let StackNavigatorFn: NavigatorFn;

  beforeAll(() => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ReminderForm render-prop delivers lifecycle:"ended" to ReminderFormScreen', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'ReminderForm');
    expect(renderProp).not.toBeNull();

    const reminderElement = renderProp!({
      route: { params: {} },
      navigation: { goBack: jest.fn() },
    });

    expect(reminderElement.type).toBe(MockReminderForm);
    expect((reminderElement.props as Record<string, unknown>).lifecycle).toBe('ended');
  });

  it('ReminderForm render-prop delivers lifecycle:undefined when snapshot is null (GAP-2)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'ReminderForm');
    const reminderElement = renderProp!({
      route: { params: {} },
      navigation: { goBack: jest.fn() },
    });

    expect((reminderElement.props as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((reminderElement.props as Record<string, unknown>).lifecycle).not.toBe('pregnant');
  });

  it('FAIL-ON-REVERT: ReminderFormScreen element carries a lifecycle prop', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'ReminderForm');
    const reminderElement = renderProp!({ route: { params: {} }, navigation: { goBack: jest.fn() } });

    expect(Object.keys(reminderElement.props as object)).toContain('lifecycle');
  });
});

// ── D. StackNavigator → AncAppointmentForm (AppointmentFormScreen) ────────────

describe('[B2 Behavioral] StackNavigator → AncAppointmentForm prop-flow', () => {
  let StackNavigatorFn: NavigatorFn;

  beforeAll(() => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AncAppointmentForm render-prop delivers lifecycle:"ended" to AppointmentFormScreen', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'AncAppointmentForm');
    expect(renderProp).not.toBeNull();

    // AncAppointmentForm render-prop signature: ({ navigation }) => ...
    const ancElement = renderProp!({ navigation: { goBack: jest.fn() } });

    expect(ancElement.type).toBe(MockAppointmentForm);
    expect((ancElement.props as Record<string, unknown>).lifecycle).toBe('ended');
  });

  it('AncAppointmentForm render-prop delivers lifecycle:undefined when snapshot is null (GAP-2)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'AncAppointmentForm');
    const ancElement = renderProp!({ navigation: { goBack: jest.fn() } });

    expect((ancElement.props as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((ancElement.props as Record<string, unknown>).lifecycle).not.toBe('pregnant');
  });

  it('FAIL-ON-REVERT: AncAppointmentForm element carries a lifecycle prop', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'AncAppointmentForm');
    const ancElement = renderProp!({ navigation: { goBack: jest.fn() } });

    expect(Object.keys(ancElement.props as object)).toContain('lifecycle');
  });
});

// ─── SOURCE-GREP SUPPLEMENTARY TESTS ──────────────────────────────────────────
//
// These tests catch string-level regressions (e.g. prop renamed, wrong variable)
// but cannot catch runtime issues like snapshot being shadowed or provider
// removed.  They are retained as a second layer alongside the behavioral tests
// above.
//
// Source files are read fresh via fs.readFileSync; the jest.mock() calls above
// do not affect plain file reads.

const BOTTOM_TAB_SRC = fs.readFileSync(
  path.join(__dirname, 'BottomTabNavigator.tsx'),
  'utf8',
);

const ROOT_NAV_SRC = fs.readFileSync(
  path.join(__dirname, 'RootNavigator.tsx'),
  'utf8',
);

const CALENDAR_SRC = fs.readFileSync(
  path.join(__dirname, '../calendar/CalendarScreen.tsx'),
  'utf8',
);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extracts the JSX block for a Tab.Screen or Stack.Screen with the given name.
 * Returns text from the `name="<screenName>"` marker through the closing tag.
 */
function extractScreenBlock(src: string, screenName: string): string {
  const marker = `name="${screenName}"`;
  const startIdx = src.indexOf(marker);
  if (startIdx === -1) return '';
  // Find enclosing block end — either </Tab.Screen> or </Stack.Screen>
  for (const closeTag of ['</Tab.Screen>', '</Stack.Screen>']) {
    const endIdx = src.indexOf(closeTag, startIdx);
    if (endIdx !== -1) return src.slice(startIdx, endIdx + closeTag.length);
  }
  return src.slice(startIdx);
}

// ─── A: BottomTabNavigator — CalendarScreen wiring ───────────────────────────

describe('[B2 LossGate Wiring] BottomTabNavigator → CalendarScreen', () => {
  it('Calendar Tab.Screen block passes lifecycle prop to CalendarScreen', () => {
    const block = extractScreenBlock(BOTTOM_TAB_SRC, 'Calendar');
    // Must use raw snapshot?.lifecycle (NOT a kickProps fallback with 'pregnant' default).
    // Any of these forms is acceptable:
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: CalendarScreen in BottomTabNavigator loses gate without lifecycle prop', () => {
    // If lifecycle= is passed, block must NOT omit it.
    // This test stays GREEN when the prop is present and RED when it is removed —
    // the same condition the LOSS-GATE test above enforces.
    const block = extractScreenBlock(BOTTOM_TAB_SRC, 'Calendar');
    expect(block).toContain('lifecycle=');
  });

  it('lifecycle passed is snapshot?.lifecycle — NOT the kickProps fallback (GAP-2)', () => {
    const block = extractScreenBlock(BOTTOM_TAB_SRC, 'Calendar');
    // The _kickProps/_kickProps fallback forces lifecycle:'pregnant' when snapshot is null
    // — that violates GAP-2 (masking a real loss as pregnant). Assert raw snapshot form.
    expect(block).not.toMatch(/lifecycle=\{_?kickProps\.lifecycle\}/);
  });
});

// ─── B: RootNavigator — AppointmentForm wiring ───────────────────────────────

describe('[B2 LossGate Wiring] RootNavigator → AppointmentForm', () => {
  it('AppointmentForm Stack.Screen block passes lifecycle prop to AppointmentFormScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AppointmentForm');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: AppointmentForm loses gate without lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AppointmentForm');
    expect(block).toContain('lifecycle=');
  });
});

// ─── C: RootNavigator — ReminderForm wiring ──────────────────────────────────

describe('[B2 LossGate Wiring] RootNavigator → ReminderForm', () => {
  it('ReminderForm Stack.Screen block passes lifecycle prop to ReminderFormScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'ReminderForm');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: ReminderForm loses gate without lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'ReminderForm');
    expect(block).toContain('lifecycle=');
  });
});

// ─── D: RootNavigator — AncAppointmentForm wiring ────────────────────────────

describe('[B2 LossGate Wiring] RootNavigator → AncAppointmentForm', () => {
  it('AncAppointmentForm Stack.Screen block passes lifecycle prop to AppointmentFormScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AncAppointmentForm');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: AncAppointmentForm loses gate without lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC, 'AncAppointmentForm');
    expect(block).toContain('lifecycle=');
  });
});

// ─── E: CalendarScreen — kickCountItems loss gate ────────────────────────────

describe('[B2 LossGate] CalendarScreen — kickCountItems gated on lifecycle', () => {
  it('kickCountItems computation is gated on lifecycle (suppressed when ended)', () => {
    // The memo must either:
    //   (a) return [] when lifecycle === 'ended', or
    //   (b) be wrapped in a conditional that prevents the call
    // Both approaches require the lifecycle variable to appear in the kickCountItems
    // computation path. Assert that 'ended' or lifecycle guards the kickCountItems useMemo.
    expect(CALENDAR_SRC).toMatch(
      /kickCountItems[\s\S]{0,200}lifecycle[\s\S]{0,200}ended|lifecycle[\s\S]{0,200}ended[\s\S]{0,200}kickCountItems/
    );
  });

  it('kickCountItems useMemo dependency array includes lifecycle', () => {
    // If lifecycle is not in deps, the gate will not re-evaluate when lifecycle changes.
    // Find the kickCountItems useMemo block and verify lifecycle is in deps.
    const memoBlock = (() => {
      const marker = 'kickCountItems = useMemo';
      const start = CALENDAR_SRC.indexOf(marker);
      if (start === -1) return '';
      // Extract from the memo through closing paren + semicolon (~300 chars is enough)
      return CALENDAR_SRC.slice(start, start + 400);
    })();
    expect(memoBlock).toContain('lifecycle');
  });

  it('kickCountItems useMemo returns [] when lifecycle === "ended" (source check)', () => {
    // The gate is implemented inside the useMemo itself: lifecycle==='ended' ? [] : getKickCount...
    // This asserts that the useMemo block contains both the 'ended' check and the empty array
    // fallback — proving the gate is NOT just a dep-array entry but actual suppression logic.
    const memoBlock = (() => {
      const marker = 'kickCountItems = useMemo';
      const start = CALENDAR_SRC.indexOf(marker);
      if (start === -1) return '';
      return CALENDAR_SRC.slice(start, start + 600);
    })();
    expect(memoBlock).toContain("'ended'");
    // Must return empty array on ended — not just track it in deps
    expect(memoBlock).toContain('[]');
  });
});

// ─── F. [B3] StackNavigator → KickCountHomeScreen ───────────────────────────
//
// GAP-1 + GAP-2: KickCountHome must receive lifecycle={snapshot?.lifecycle}
// (raw from context, NOT kickProps.lifecycle which defaults to 'pregnant').
//
// Pattern: same as B, C, D above — extract StackNavigator, find render-prop,
// invoke it, assert child element props.

describe('[B3 Behavioral] StackNavigator → KickCountHomeScreen prop-flow', () => {
  let StackNavigatorFn: NavigatorFn;

  beforeAll(() => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('KickCountHome render-prop delivers lifecycle:"ended" when snapshot.lifecycle="ended"', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'KickCountHome');
    expect(renderProp).not.toBeNull();

    // Invoke the render-prop (no route params for KickCountHome)
    const homeElement = renderProp!({ navigation: { navigate: jest.fn(), goBack: jest.fn() } });

    expect(homeElement.type).toBe(MockKickCountHome);
    expect((homeElement.props as Record<string, unknown>).lifecycle).toBe('ended');
  });

  it('KickCountHome render-prop delivers lifecycle:undefined when snapshot is null (GAP-2)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'KickCountHome');
    const homeElement = renderProp!({ navigation: { navigate: jest.fn(), goBack: jest.fn() } });

    // GAP-2: must be undefined, NOT 'pregnant' (kickProps fallback removed)
    expect((homeElement.props as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((homeElement.props as Record<string, unknown>).lifecycle).not.toBe('pregnant');
  });

  it('FAIL-ON-REVERT: KickCountHomeScreen element carries a lifecycle prop (guards wiring site)', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'KickCountHome');
    const homeElement = renderProp!({ navigation: { navigate: jest.fn(), goBack: jest.fn() } });

    // Goes RED the moment lifecycle= is removed from the KickCountHome Stack.Screen
    expect(Object.keys(homeElement.props as object)).toContain('lifecycle');
  });
});

// ─── G. [B3] Source-grep: KickCountHome wiring uses snapshot?.lifecycle ──────

const ROOT_NAV_SRC_B3 = ROOT_NAV_SRC; // already loaded above

describe('[B3 LossGate Wiring] RootNavigator → KickCountHome', () => {
  it('KickCountHome Stack.Screen block passes lifecycle prop via snapshot?.lifecycle (NOT kickProps)', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B3, 'KickCountHome');
    // Must use raw snapshot?.lifecycle — NOT kickProps.lifecycle (which defaults 'pregnant')
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: KickCountHome Stack.Screen block contains lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B3, 'KickCountHome');
    expect(block).toContain('lifecycle=');
  });

  it('KickCountHome does NOT use kickProps.lifecycle fallback (GAP-2)', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B3, 'KickCountHome');
    expect(block).not.toMatch(/lifecycle=\{kickProps\.lifecycle\}/);
  });
});

// ─── H. [B4] StackNavigator → PregnancySummaryWrapper ────────────────────────
//
// PregnancySummaryWrapper is an unexported inner component of RootNavigator.
// The lifecycle prop is threaded: snapshot?.lifecycle → wrapper prop → PregnancySummaryScreen.
//
// BEHAVIORAL: render-prop for 'PregnancySummary' screen returns a React element
// whose props contain `lifecycle`. We verify the element's props — the wrapper is
// NOT rendered (hooks are mocked), so this tests the call-site binding only.
//
// SOURCE-GREP: verifies the internal pass-through inside the wrapper to PregnancySummaryScreen.

describe('[B4 Behavioral] StackNavigator → PregnancySummaryWrapper prop-flow', () => {
  let StackNavigatorFn: NavigatorFn;

  beforeAll(() => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);
    StackNavigatorFn = getStackNavigatorFn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('PregnancySummary render-prop delivers lifecycle:"ended" to PregnancySummaryWrapper', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'PregnancySummary');
    expect(renderProp).not.toBeNull();

    // Invoking the render-prop returns a <PregnancySummaryWrapper ...> element (not yet rendered).
    // The wrapper IS the real function (not mocked), so we inspect its props directly.
    const wrapperElement = renderProp!({ navigation: { goBack: jest.fn(), reset: jest.fn() } });

    // The wrapper element should carry lifecycle: 'ended' from snapshot?.lifecycle
    expect((wrapperElement.props as Record<string, unknown>).lifecycle).toBe('ended');
  });

  it('PregnancySummary render-prop delivers lifecycle:undefined when snapshot is null (GAP-2)', () => {
    mockUseProfileSnapshot.mockReturnValue(null);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'PregnancySummary');
    const wrapperElement = renderProp!({ navigation: { goBack: jest.fn(), reset: jest.fn() } });

    // GAP-2: must be undefined, NOT 'pregnant'
    expect((wrapperElement.props as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((wrapperElement.props as Record<string, unknown>).lifecycle).not.toBe('pregnant');
  });

  it('FAIL-ON-REVERT: PregnancySummaryWrapper element carries a lifecycle prop (guards wiring site)', () => {
    mockUseProfileSnapshot.mockReturnValue(ENDED_SNAPSHOT);

    const stackElement = StackNavigatorFn({ tokenStorage: mockTokenStorage, apiBaseUrl: '' });
    const renderProp = findScreenRenderProp(stackElement, 'PregnancySummary');
    const wrapperElement = renderProp!({ navigation: { goBack: jest.fn(), reset: jest.fn() } });

    // Goes RED the moment lifecycle= is removed from the PregnancySummary Stack.Screen
    expect(Object.keys(wrapperElement.props as object)).toContain('lifecycle');
  });
});

// ─── I. [B4] Source-grep: PregnancySummary wiring ───────────────────────────

const ROOT_NAV_SRC_B4 = ROOT_NAV_SRC; // already loaded above

describe('[B4 LossGate Wiring] RootNavigator → PregnancySummary call-site', () => {
  it('PregnancySummary Stack.Screen block passes lifecycle to PregnancySummaryWrapper', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B4, 'PregnancySummary');
    expect(block).toMatch(/lifecycle=\{snapshot\?\.lifecycle\}/);
  });

  it('FAIL-ON-REVERT: PregnancySummary Stack.Screen block contains lifecycle prop', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B4, 'PregnancySummary');
    expect(block).toContain('lifecycle=');
  });

  it('PregnancySummary wrapper threads lifecycle to PregnancySummaryScreen (source-grep)', () => {
    // Verify the internal pass-through: PregnancySummaryWrapper passes lifecycle to the screen.
    // The pattern is: <PregnancySummaryScreen ... lifecycle={lifecycle} .../>
    expect(ROOT_NAV_SRC_B4).toMatch(/lifecycle=\{lifecycle\}/);
  });
});

// ─── J. [B4] Source-grep: DoctorReport lifecycle wiring (already present) ────

describe('[B4 LossGate Wiring] RootNavigator → DoctorReport lifecycle', () => {
  it('DoctorReport Stack.Screen passes lifecycle: snapshot.lifecycle to DoctorPdfScreen', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B4, 'DoctorReport');
    expect(block).toContain('lifecycle: snapshot.lifecycle');
  });

  it('FAIL-ON-REVERT: DoctorReport block contains lifecycle key', () => {
    const block = extractScreenBlock(ROOT_NAV_SRC_B4, 'DoctorReport');
    expect(block).toContain('lifecycle');
  });
});
