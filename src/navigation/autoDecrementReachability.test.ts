/**
 * autoDecrementReachability.test.ts — Navigation reachability guard for
 * Screen 1 (AutoDecrementSettings) and Screen 2 (SubUnitSetup).
 *
 * Replaces the previous source-string (fs.readFileSync) inspection approach
 * with BEHAVIORAL tests that call real navigator + screen code, following the
 * exact same pattern as lossGateWiring.test.ts.
 *
 * ─── Sections ─────────────────────────────────────────────────────────────────
 *   A. TypeScript type-level guards (RootStackParamList; SD-9 no health data
 *      in params).
 *   B. SuppliesScreen button test — pressing the real in-app entry button calls
 *      onAutoDecrementSettings (behavioral, not source-string).
 *   C. BottomTabNavigator wires the callback to navigate('AutoDecrementSettings').
 *   D. RootNavigator registers AutoDecrementSettingsScreen and wires
 *      onNavigateSubUnitSetup → navigate('SubUnitSetup', { supplyItemId }).
 *
 * Fail-on-revert guarantee: removing the button from SuppliesScreen makes B
 * RED; removing the navigate call from BottomTabNavigator makes C RED; removing
 * the screen registration from RootNavigator makes D RED.
 *
 * Method: call components/navigators as plain functions (no fiber/RNTL/
 * NavigationContainer). Screen element types are jest.fn() so element.type
 * comparisons work. Hooks are mocked so components execute synchronously.
 */

// ─── Module mocks (hoisted before all imports) ────────────────────────────────
// Pattern is identical to lossGateWiring.test.ts.

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
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })), removeEventListener: jest.fn() },
  Modal: 'Modal',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Platform: { OS: 'ios' },
  FlatList: 'FlatList',
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({ Navigator: 'Tab.Navigator', Screen: 'Tab.Screen' }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: 'Stack.Navigator', Screen: 'Stack.Screen' }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((fn: () => void) => fn()),
  useNavigation: jest.fn(() => ({ navigate: jest.fn(), goBack: jest.fn() })),
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshot: jest.fn(() => null),
  PregnancyProfileProvider: ({ children }: { children: unknown }) => children,
  useProfileSnapshotSetter: jest.fn(() => jest.fn()),
}));

jest.mock('../pregnancy/gestationalAge', () => ({
  localCivilToday: jest.fn(() => '2026-07-11'),
}));

// ── Icon mocks ─────────────────────────────────────────────────────────────────
jest.mock('../icons', () => ({
  TabChecklistIcon: 'TabChecklistIcon',
  TabCoinsIcon: 'TabCoinsIcon',
  TabHomeIcon: 'TabHomeIcon',
  TabCalendarIcon: 'TabCalendarIcon',
  TabPillIcon: 'TabPillIcon',
  TabPersonIcon: 'TabPersonIcon',
}));

// ── Screen mocks: jest.fn() so element.type comparison works ──────────────────
jest.mock('../screens/HomeTabScreen', () => ({ HomeTabScreen: jest.fn(() => null) }));
jest.mock('../calendar/CalendarScreen', () => ({
  CalendarScreen: jest.fn(() => null),
  filterLossStateItems: jest.fn((items: unknown) => items),
}));
jest.mock('../supplies/SuppliesScreen', () => ({ SuppliesScreen: jest.fn(() => null) }));
jest.mock('../expenses/ExpensesScreen', () => ({ ExpensesScreen: jest.fn(() => null) }));
jest.mock('../medication/MedicationPlanListScreen', () => ({ MedicationPlanListScreen: jest.fn(() => null) }));
jest.mock('../profile/ProfileHubScreen', () => ({ ProfileHubScreen: jest.fn(() => null) }));
jest.mock('../autoStockDecrement/AutoDecrementSettingsScreen', () => ({
  AutoDecrementSettingsScreen: jest.fn(() => null),
}));
jest.mock('../autoStockDecrement/SubUnitSetupScreen', () => ({
  SubUnitSetupScreen: jest.fn(() => null),
}));

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
jest.mock('../calendar/AppointmentFormScreen', () => ({
  AppointmentFormScreen: jest.fn(() => null),
}));
jest.mock('../calendar/ReminderFormScreen', () => ({
  ReminderFormScreen: jest.fn(() => null),
}));

// ── Shared store mocks ─────────────────────────────────────────────────────────
jest.mock('../sync/supplySyncStore', () => ({
  supplySyncStore: {
    getSupplyItems: jest.fn(() => []),
    getSupplyItem: jest.fn(() => undefined),
    getWatermark: jest.fn(() => undefined),
    getPendingCount: jest.fn(() => 0),
    drainQueue: jest.fn(() => ({ supplyItems: { created: [], updated: [], deleted: [] } })),
    reset: jest.fn(),
  },
}));
jest.mock('../sync/calendarSyncStore', () => ({
  calendarSyncStore: {
    getChecklistItem: jest.fn(() => null),
    getReminder: jest.fn(() => null),
    getActiveChecklistItems: jest.fn(() => []),
    getActiveReminders: jest.fn(() => []),
    getOccurrencesForReminder: jest.fn(() => []),
    drainQueue: jest.fn(() => ({})),
    reset: jest.fn(),
  },
}));
jest.mock('../consent/consentStore', () => ({
  consentStore: { isGranted: jest.fn(() => true), reset: jest.fn() },
}));
jest.mock('../sync/syncClient', () => ({
  createSyncClient: jest.fn(() => ({ push: jest.fn(), pull: jest.fn() })),
  createCalendarSyncClient: jest.fn(() => ({ push: jest.fn(), pull: jest.fn() })),
  createConsumptionMappingSyncClient: jest.fn(() => ({ push: jest.fn(), pull: jest.fn() })),
}));
jest.mock('../sync/pushOrchestrator', () => ({
  executePush: jest.fn(() => Promise.resolve({ ok: true })),
}));
jest.mock('../auth/tokenStorage', () => ({
  createTokenStorage: jest.fn(() => ({
    load: jest.fn(() => Promise.resolve(null)),
    save: jest.fn(),
    clear: jest.fn(),
  })),
}));
jest.mock('../calendar/pendingCalendarFocusDate', () => ({
  consumePendingCalendarFocusDate: jest.fn(() => null),
}));
jest.mock('../kickCount/kickCountSyncStore', () => ({ kickCountSyncStore: { reset: jest.fn() } }));
jest.mock('../kickCount/kickCountDraftStore', () => ({ clearDraft: jest.fn() }));
jest.mock('../consent/consentSync', () => ({ resetConsentQueue: jest.fn() }));
jest.mock('../suggestion/suggestionStore', () => ({ suggestionStore: { reset: jest.fn() } }));
jest.mock('../expenses/expensesSyncStore', () => ({ expensesSyncStore: { reset: jest.fn() } }));
jest.mock('../selfLog/selfLogSyncStore', () => ({ selfLogSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationPlanSyncStore', () => ({ medicationPlanSyncStore: { reset: jest.fn() } }));
jest.mock('../medication/medicationLogSyncStore', () => ({ medicationLogSyncStore: { reset: jest.fn() } }));
jest.mock('../auth/performLogout', () => ({ performLogout: jest.fn() }));
jest.mock('../calendar/calendarAddCaptureHandler', () => ({
  buildAddCaptureParams: jest.fn((date: unknown) => ({ loggedAtDate: date })),
}));
jest.mock('../medication/logDoseParams', () => ({
  buildLogDoseParams: jest.fn((id: unknown) => ({ planId: id })),
}));
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

// ─── Imports (after mock declarations) ───────────────────────────────────────

import React from 'react';
import type { RootStackParamList } from './types';
import { BottomTabNavigator, type BottomTabNavigatorProps } from './BottomTabNavigator';
import { RootNavigator } from './RootNavigator';
import { SuppliesScreen } from '../supplies/SuppliesScreen';
import { AutoDecrementSettingsScreen } from '../autoStockDecrement/AutoDecrementSettingsScreen';
import { SubUnitSetupScreen } from '../autoStockDecrement/SubUnitSetupScreen';

// ─── Typed mock handles ───────────────────────────────────────────────────────

const MockSuppliesScreen = SuppliesScreen as unknown as jest.Mock;
const MockASDSettings    = AutoDecrementSettingsScreen as unknown as jest.Mock;
const MockSubUnitSetup   = SubUnitSetupScreen as unknown as jest.Mock;

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve(null)),
  save: jest.fn(),
  clear: jest.fn(),
};

/** Minimal root-stack navigation prop (same shape as lossGateWiring.test.ts). */
const mockRootNavigation = {
  navigate: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
} as unknown as BottomTabNavigatorProps['navigation'];

// ─── Helpers (following lossGateWiring.test.ts convention) ───────────────────

/**
 * Traverses the direct children of a Navigator element and returns the
 * `children` render-prop of the Screen named `screenName`.
 * Works for both Tab.Screen and Stack.Screen (both mocked as plain strings).
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

/** Recursively find all elements in a tree matching predicate. */
function findAll(
  node: unknown,
  pred: (el: React.ReactElement) => boolean,
): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || typeof n === 'string' || typeof n === 'number' || typeof n === 'boolean') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

/**
 * Extract the StackNavigator function from inside RootNavigator.
 * RootNavigator wraps the unexported StackNavigator in PregnancyProfileProvider
 * (which is mocked as ({ children }) => children), so the structure is:
 *   rootElement = { type: MockPregnancyProfileProvider, props: { children: <StackNavigator .../> } }
 * Pattern is verbatim from lossGateWiring.test.ts getStackNavigatorFn.
 */
type NavigatorFn = (props: {
  tokenStorage: typeof mockTokenStorage;
  apiBaseUrl: string;
}) => React.ReactElement;

function getStackNavigatorFn(): NavigatorFn {
  const rootElement = (RootNavigator as unknown as NavigatorFn)({
    tokenStorage: mockTokenStorage,
    apiBaseUrl: '',
  });
  const childElement = (rootElement.props as { children: React.ReactElement }).children;
  return childElement.type as unknown as NavigatorFn;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRootNavigation.navigate = jest.fn() as never;
  mockRootNavigation.reset    = jest.fn() as never;
});

// ─── A: TypeScript type-level guards (compile-time; SD-9) ────────────────────

describe('[ASD Reachability] A — TypeScript route param guards (SD-9)', () => {
  it('RootStackParamList includes AutoDecrementSettings with undefined params', () => {
    // Compile-time: if this key is missing, the HasKey type assignment fails.
    type HasKey = 'AutoDecrementSettings' extends keyof RootStackParamList ? true : false;
    const check: HasKey = true;
    expect(check).toBe(true);
    // SD-9: no health data in params
    const _params: RootStackParamList['AutoDecrementSettings'] = undefined;
    expect(_params).toBeUndefined();
  });

  it('RootStackParamList includes SubUnitSetup with supplyItemId only (SD-9: UUID, no health data)', () => {
    type HasKey = 'SubUnitSetup' extends keyof RootStackParamList ? true : false;
    const check: HasKey = true;
    expect(check).toBe(true);
    // Only a supply-item UUID — no names, quantities, or health values in params.
    const _params: RootStackParamList['SubUnitSetup'] = { supplyItemId: 'uuid-only' };
    expect(_params.supplyItemId).toBe('uuid-only');
  });
});

// ─── B: SuppliesScreen entry button — behavioral ──────────────────────────────
//
// Uses jest.requireActual to call the REAL SuppliesScreen (the module-level mock
// is only for section C where we need element.type equality). All dependencies
// (hooks, stores, syncClient) are already mocked at module level.

describe('[ASD Reachability] B — SuppliesScreen entry button (behavioral)', () => {
  it('pressing supplies-auto-decrement-settings button calls onAutoDecrementSettings', () => {
    const onAutoDecrementSettings = jest.fn();
    const {
      SuppliesScreen: RealSuppliesScreen,
    } = jest.requireActual<typeof import('../supplies/SuppliesScreen')>('../supplies/SuppliesScreen');

    // Call the real component as a plain function (hooks are mocked; no fiber needed).
    const tree = (RealSuppliesScreen as Function)({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://test.example.com',
      onAutoDecrementSettings,
    }) as React.ReactElement;

    // Find the entry-point button by its testID (same tag used in a11y tests).
    const buttons = findAll(
      tree,
      (el) => (el.props as { testID?: string }).testID === 'supplies-auto-decrement-settings',
    );
    expect(buttons.length).toBeGreaterThan(0);

    // Simulate the tap — must invoke the wired callback exactly once.
    const button = buttons[0]!;
    (button.props as { onPress: () => void }).onPress();
    expect(onAutoDecrementSettings).toHaveBeenCalledTimes(1);
  });

  it('button is not rendered when onAutoDecrementSettings prop is absent', () => {
    const {
      SuppliesScreen: RealSuppliesScreen,
    } = jest.requireActual<typeof import('../supplies/SuppliesScreen')>('../supplies/SuppliesScreen');

    const tree = (RealSuppliesScreen as Function)({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://test.example.com',
      // onAutoDecrementSettings intentionally absent — the conditional render hides it
    }) as React.ReactElement;

    const buttons = findAll(
      tree,
      (el) => (el.props as { testID?: string }).testID === 'supplies-auto-decrement-settings',
    );
    expect(buttons.length).toBe(0);
  });
});

// ─── C: BottomTabNavigator wires onAutoDecrementSettings ─────────────────────

describe('[ASD Reachability] C — BottomTabNavigator prop wiring', () => {
  it('Supplies Tab.Screen render-prop passes onAutoDecrementSettings wired to navigate("AutoDecrementSettings")', () => {
    const tabNavElement = (BottomTabNavigator as unknown as (p: BottomTabNavigatorProps) => React.ReactElement)({
      tokenStorage: mockTokenStorage as never,
      apiBaseUrl: 'https://test.example.com',
      navigation: mockRootNavigation,
    });

    // findScreenRenderProp follows lossGateWiring.test.ts — extracts the
    // children render-prop from Tab.Screen with name="Supplies".
    const suppliesRenderProp = findScreenRenderProp(tabNavElement, 'Supplies');
    expect(suppliesRenderProp).not.toBeNull();

    // Invoke to get the element: React.createElement(MockSuppliesScreen, { ..., onAutoDecrementSettings })
    const suppliesElement = suppliesRenderProp!();
    expect(suppliesElement.type).toBe(MockSuppliesScreen);

    // The prop must exist and be a function.
    const props = suppliesElement.props as { onAutoDecrementSettings?: () => void };
    expect(typeof props.onAutoDecrementSettings).toBe('function');

    // Calling it must fire navigate('AutoDecrementSettings') — proves the real binding.
    props.onAutoDecrementSettings!();
    expect(mockRootNavigation.navigate).toHaveBeenCalledWith('AutoDecrementSettings');
  });

  it('FAIL-ON-REVERT: onAutoDecrementSettings prop is present on the SuppliesScreen element', () => {
    // This test turns RED the moment `onAutoDecrementSettings={...}` is removed
    // from the Supplies Tab.Screen render-prop in BottomTabNavigator.tsx.
    const tabNavElement = (BottomTabNavigator as unknown as (p: BottomTabNavigatorProps) => React.ReactElement)({
      tokenStorage: mockTokenStorage as never,
      apiBaseUrl: 'https://test.example.com',
      navigation: mockRootNavigation,
    });
    const suppliesRenderProp = findScreenRenderProp(tabNavElement, 'Supplies');
    const el = suppliesRenderProp!();
    expect((el.props as Record<string, unknown>).onAutoDecrementSettings).toBeDefined();
  });
});

// ─── D: RootNavigator screen registration ────────────────────────────────────

describe('[ASD Reachability] D — RootNavigator screen registration and wiring', () => {
  it('AutoDecrementSettings stack screen is registered with a callable render-prop', () => {
    const StackNavigatorFn = getStackNavigatorFn();
    const stackElement = StackNavigatorFn({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://test.example.com',
    });

    const asdRenderProp = findScreenRenderProp(stackElement, 'AutoDecrementSettings');
    expect(asdRenderProp).not.toBeNull();

    // The render-prop signature is ({ navigation: nav }) — pass a mock nav object.
    const mockScreenNav = { navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
    const asdElement = asdRenderProp!({ navigation: mockScreenNav });
    expect(asdElement.type).toBe(MockASDSettings);
  });

  it('SubUnitSetup stack screen is registered with a callable render-prop', () => {
    const StackNavigatorFn = getStackNavigatorFn();
    const stackElement = StackNavigatorFn({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://test.example.com',
    });

    const subUnitRenderProp = findScreenRenderProp(stackElement, 'SubUnitSetup');
    expect(subUnitRenderProp).not.toBeNull();

    // Pass the route arg that the render-prop receives from the navigator at runtime.
    const subUnitElement = subUnitRenderProp!({
      route: { params: { supplyItemId: 'test-item-id' } },
    });
    expect(subUnitElement.type).toBe(MockSubUnitSetup);
  });

  it('AutoDecrementSettings onNavigateSubUnitSetup wires to navigate("SubUnitSetup", { supplyItemId })', () => {
    // This is the deep-link path: ASD Settings → SubUnitSetup → pass UUID only (SD-9).
    const StackNavigatorFn = getStackNavigatorFn();
    const stackElement = StackNavigatorFn({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://test.example.com',
    });

    const asdRenderProp = findScreenRenderProp(stackElement, 'AutoDecrementSettings');
    // The render-prop receives ({ navigation: nav }) from the Stack.Screen at runtime.
    // nav is the screen-level navigation object (NOT the root navigation).
    const mockScreenNav = { navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
    const asdElement = asdRenderProp!({ navigation: mockScreenNav });
    const props = asdElement.props as {
      onNavigateSubUnitSetup?: (supplyItemId: string) => void;
    };

    expect(typeof props.onNavigateSubUnitSetup).toBe('function');

    // Calling the prop must fire nav.navigate('SubUnitSetup', { supplyItemId }) — proves SD-9 wiring.
    props.onNavigateSubUnitSetup!('supply-uuid-abc');
    expect(mockScreenNav.navigate).toHaveBeenCalledWith('SubUnitSetup', {
      supplyItemId: 'supply-uuid-abc',
    });
  });
});
