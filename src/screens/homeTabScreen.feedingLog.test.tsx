/**
 * homeTabScreen.feedingLog.test.tsx — TDD RED → GREEN
 *
 * Bug #4 (🟢): "ย้ายบันทึกการให้นมไปอยู่ในหน้าหลัก" (move feeding-log entry to Home).
 *
 * Requirements:
 *   - HomeTabScreen gains an `onFeedingLog?: () => void` prop.
 *   - Renders a feeding-log entry row in NON-LOSS states: pregnant (!isLoss) and postpartum.
 *   - Pressing the row invokes onFeedingLog.
 *   - MUST be hidden when lifecycle==='ended' (isLoss) — loss-gate discipline.
 *
 * Approach: mock `react` hooks so calling HomeTabScreen(props) as a plain function
 * renders synchronously (same pattern as calendarHandlerWiring.test.ts /
 * lossGateWiring.test.ts). `useState` is mocked to return a per-call-index
 * overridable value so we can force the internal `state` to 'pregnant' /
 * 'postpartum' without running the real async loadProfile() effect.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  SafeAreaView: 'SafeAreaView',
  StyleSheet: { create: (o: unknown) => o },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: jest.fn(() => ({ t: (k: string) => k, locale: 'th' })),
}));

jest.mock('../pregnancy/PregnancyProfileContext', () => ({
  useProfileSnapshotSetter: jest.fn(() => jest.fn()),
}));

jest.mock('../pregnancy/pregnancyApiClient', () => ({
  createPregnancyClient: jest.fn(() => ({ getProfile: jest.fn() })),
}));

jest.mock('../consent/consentStore', () => ({
  consentStore: {
    loadFromStorage: jest.fn(),
    isGranted: jest.fn(() => false),
    hydrate: jest.fn(),
  },
}));

jest.mock('../consent/consentApiClient', () => ({
  createConsentApiClient: jest.fn(() => ({ getConsents: jest.fn() })),
}));

jest.mock('../consent/consentSync', () => ({
  drainConsentQueue: jest.fn(),
}));

jest.mock('../suggestion/suggestionEngine', () => ({
  getOfferable: jest.fn(() => []),
}));

jest.mock('../suggestion/suggestionStore', () => ({
  suggestionStore: {
    loadFromStorage: jest.fn(),
    getState: jest.fn(() => ({})),
    dismiss: jest.fn(),
  },
}));

jest.mock('../suggestion/SuggestionBanner', () => ({
  SuggestionBanner: 'SuggestionBanner',
}));

jest.mock('./calendarDashboardSections', () => ({
  resolveCalendarDashboardSections: jest.fn(() => ({
    showStageBanner: true,
    showKickCountCard: true,
    showSuggestionBanner: false,
    showProgressBar: true,
    showDaysToDue: true,
    showPostpartumDayCard: true,
    showPostpartumHistoryLink: false,
  })),
}));

jest.mock('./calendarTabSuggestionRouting', () => ({
  resolveSuggestionAction: jest.fn(() => jest.fn()),
}));

jest.mock('./homeTabSnapshotLoader', () => ({
  loadProfileIntoSnapshot: jest.fn(),
}));

jest.mock('../pregnancy/gestationalAge', () => ({
  computeGestationalAge: jest.fn(),
  localCivilToday: jest.fn(() => '2026-07-07'),
}));

jest.mock('../pregnancy/postpartumAge', () => ({
  computePostpartumAge: jest.fn(),
}));

jest.mock('../i18n/messages', () => ({
  formatCivilDate: jest.fn((d: string) => d),
}));

jest.mock('../icons', () => ({
  StageT1Icon: 'StageT1Icon',
  StageT2Icon: 'StageT2Icon',
  StageT3Icon: 'StageT3Icon',
  PostpartumStageIcon: 'PostpartumStageIcon',
}));

jest.mock('../illustrations/JasmineDivider', () => ({
  JasmineDivider: 'JasmineDivider',
}));

jest.mock('../home/AccentRow', () => ({
  AccentRow: 'AccentRow',
}));

jest.mock('../home/BabySizeSection', () => ({
  BabySizeSection: 'BabySizeSection',
}));

jest.mock('./WeeklyMilestoneSheet', () => ({
  WeeklyMilestoneSheet: 'WeeklyMilestoneSheet',
}));

// ── useState override: module-level queue so each test can force the initial
// `state` value (first useState call in HomeTabScreen) to a specific ScreenState
// without running the real async loadProfile effect. Subsequent useState calls
// (suggestionTick, milestoneSheetVisible) fall back to the real init value.
let forcedScreenState: unknown = null;

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  let callIndex = 0;
  return {
    ...actual,
    useState: jest.fn((init: unknown) => {
      callIndex += 1;
      if (callIndex === 1 && forcedScreenState !== null) {
        return [forcedScreenState, jest.fn()];
      }
      return [typeof init === 'function' ? (init as () => unknown)() : init, jest.fn()];
    }),
    useRef: jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useEffect: jest.fn(),
  };
});

// Reset the call-index counter (module-scoped inside the mock factory) between
// tests by resetting modules — simplest reliable approach given the closure.
beforeEach(() => {
  jest.resetModules();
});

// ─── Imports ──────────────────────────────────────────────────────────────────

// Imported lazily per-test via require() after jest.resetModules() so the
// `react` mock's callIndex closure resets cleanly between tests.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findAll(node: unknown, pred: (el: import('react').ReactElement) => boolean): import('react').ReactElement[] {
  const React = require('react');
  const acc: import('react').ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as import('react').ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

const PREGNANT_PROFILE = {
  version: 1,
  edd: '2026-12-01',
  lifecycle: 'pregnant' as const,
  birthDate: null,
};

const LOSS_PROFILE = {
  version: 1,
  edd: '2026-12-01',
  lifecycle: 'ended' as const,
  birthDate: null,
};

const POSTPARTUM_PROFILE = {
  version: 1,
  edd: '2026-01-01',
  lifecycle: 'postpartum' as const,
  birthDate: '2026-01-01',
};

const GA_FIXTURE = {
  gestationalWeek: 20,
  gestationalDay: 0,
  displayedWeek: 20,
  suppressDayDisplay: false,
  currentStage: 'T2' as const,
  progress: 0.5,
};

const PP_FIXTURE = {
  postpartumWeek: 2,
  postpartumDay: 0,
  postpartumDays: 14,
};

function baseProps(onFeedingLog?: () => void): Record<string, unknown> {
  return {
    tokenStorage: { load: jest.fn(() => Promise.resolve(null)), save: jest.fn(), clear: jest.fn() },
    apiBaseUrl: 'https://api.example.com',
    onLogout: jest.fn(),
    onNeedsProfile: jest.fn(),
    onBirthEvent: jest.fn(),
    onDoctorReport: jest.fn(),
    onCapture: jest.fn(),
    onFeedingLog,
  };
}

describe('HomeTabScreen — Bug #4: feeding-log entry (pregnant, non-loss)', () => {
  it('renders a feeding-log row and invokes onFeedingLog on press', () => {
    forcedScreenState = { kind: 'pregnant', profile: PREGNANT_PROFILE, ga: GA_FIXTURE };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const onFeedingLog = jest.fn();
    const tree = HomeTabScreen(baseProps(onFeedingLog));

    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-feeding-log-row');
    expect(rows.length).toBe(1);

    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    expect(typeof onPress).toBe('function');
    onPress();
    expect(onFeedingLog).toHaveBeenCalledTimes(1);
  });
});

describe('HomeTabScreen — Bug #4: feeding-log entry (postpartum)', () => {
  it('renders a feeding-log row and invokes onFeedingLog on press', () => {
    forcedScreenState = { kind: 'postpartum', profile: POSTPARTUM_PROFILE, pp: PP_FIXTURE };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const onFeedingLog = jest.fn();
    const tree = HomeTabScreen(baseProps(onFeedingLog));

    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-feeding-log-row');
    expect(rows.length).toBe(1);

    const onPress = (rows[0]!.props as Record<string, unknown>).onPress as () => void;
    onPress();
    expect(onFeedingLog).toHaveBeenCalledTimes(1);
  });
});

describe('HomeTabScreen — Bug #4: loss-gate discipline (lifecycle=ended)', () => {
  it('does NOT render the feeding-log row when lifecycle is "ended" (isLoss)', () => {
    forcedScreenState = { kind: 'pregnant', profile: LOSS_PROFILE, ga: GA_FIXTURE };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const onFeedingLog = jest.fn();
    const tree = HomeTabScreen(baseProps(onFeedingLog));

    const rows = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-feeding-log-row');
    expect(rows).toHaveLength(0);
  });
});
