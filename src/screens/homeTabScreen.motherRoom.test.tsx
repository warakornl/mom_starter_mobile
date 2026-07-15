/**
 * homeTabScreen.motherRoom.test.tsx
 * TDD: ห้องแม่ CLUSTER 2 UX/UI review fixes — HomeTabScreen.
 *
 * Covers:
 *  - FAIL-ON-REVERT: the T3 birth-event CTA (home-birth-cta) is a SIBLING of
 *    the accessibilityElementsHidden stage-label row, not a descendant of it.
 *    (containment rule: an accessibilityElementsHidden subtree swallows ALL
 *    descendants on VoiceOver — a nested TouchableOpacity becomes permanently
 *    unreachable). Regression coverage for the pre-fix bug where the CTA was
 *    INSIDE the hidden row.
 *  - Offline state: when the error message matches the RN fetch-polyfill's
 *    'Network request failed' string, ErrorPanel renders the calm
 *    T.offlinePill treatment (home-offline-pill) instead of the generic
 *    alarming error headline.
 *  - Generic (non-network) errors still render the standard error headline,
 *    not the offline pill.
 *
 * Approach: same convention as homeTabScreen.feedingLog.test.tsx — mock
 * `react` hooks so calling HomeTabScreen(props) as a plain function renders
 * synchronously, and force the internal `state` via the useState mock.
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

beforeEach(() => {
  jest.resetModules();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// NOTE: HomeTabScreen composes several plain function components (StageBadge,
// WeekHeroZone, AmberCtaCard, ErrorPanel, ...) which appear in the returned
// element tree as `{ type: [Function], props }` — React does NOT expand
// these until an actual renderer mounts them. Since these tests call
// HomeTabScreen(props) directly (no renderer), the walker below must
// recursively INVOKE any function-type element with its own props to expand
// it into its real returned tree — otherwise nested testIDs (e.g.
// home-birth-cta inside StageBadge) are invisible to findAll/isDescendantOf.
function expand(el: import('react').ReactElement): unknown {
  if (typeof el.type === 'function') {
    return (el.type as (props: unknown) => unknown)(el.props);
  }
  return (el.props as { children?: unknown }).children;
}

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
    walk(expand(el));
  }
  walk(node);
  return acc;
}

/** Returns true when `target` is a descendant of any element matching `ancestorPred`. */
function isDescendantOf(
  root: unknown,
  ancestorPred: (el: import('react').ReactElement) => boolean,
  targetPred: (el: import('react').ReactElement) => boolean,
): boolean {
  const React = require('react');
  let found = false;
  function walk(n: unknown, insideAncestor: boolean): void {
    if (n == null || n === false || n === true) return;
    if (typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach((c) => walk(c, insideAncestor)); return; }
    if (!React.isValidElement(n)) return;
    const el = n as import('react').ReactElement;
    const nowInside = insideAncestor || ancestorPred(el);
    if (nowInside && targetPred(el)) found = true;
    walk(expand(el), nowInside);
  }
  walk(root, false);
  return found;
}

const PREGNANT_T3_PROFILE = {
  version: 1,
  edd: '2026-08-01',
  lifecycle: 'pregnant' as const,
  birthDate: null,
};

const GA_T3_FIXTURE = {
  gestationalWeek: 30,
  gestationalDay: 0,
  displayedWeek: 30,
  suppressDayDisplay: false,
  currentStage: 'T3' as const,
  progress: 0.75,
};

function baseProps(): Record<string, unknown> {
  return {
    tokenStorage: { load: jest.fn(() => Promise.resolve(null)), save: jest.fn(), clear: jest.fn() },
    apiBaseUrl: 'https://api.example.com',
    onLogout: jest.fn(),
    onNeedsProfile: jest.fn(),
    onBirthEvent: jest.fn(),
    onDoctorReport: jest.fn(),
    onCapture: jest.fn(),
  };
}

describe('HomeTabScreen — StageBadge birth-CTA a11y containment fix', () => {
  it('FAIL-ON-REVERT: home-birth-cta is NOT nested inside an accessibilityElementsHidden container', () => {
    forcedScreenState = { kind: 'pregnant', profile: PREGNANT_T3_PROFILE, ga: GA_T3_FIXTURE };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const tree = HomeTabScreen(baseProps());

    const birthCtaButtons = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-birth-cta');
    expect(birthCtaButtons.length).toBe(1);

    const hiddenInside = isDescendantOf(
      tree,
      (el) => (el.props as Record<string, unknown>).accessibilityElementsHidden === true,
      (el) => (el.props as Record<string, unknown>).testID === 'home-birth-cta',
    );
    expect(hiddenInside).toBe(false);
  });

  it('home-birth-cta is still reachable and invokes onBirthEvent with the profile version', () => {
    forcedScreenState = { kind: 'pregnant', profile: PREGNANT_T3_PROFILE, ga: GA_T3_FIXTURE };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const onBirthEvent = jest.fn();
    const tree = HomeTabScreen({ ...baseProps(), onBirthEvent });

    const btn = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-birth-cta')[0];
    expect(btn).toBeDefined();
    const onPress = (btn!.props as Record<string, unknown>).onPress as () => void;
    onPress();
    expect(onBirthEvent).toHaveBeenCalledWith(PREGNANT_T3_PROFILE.version);
  });
});

describe('HomeTabScreen — offline state rendering (§4.1 state matrix)', () => {
  it('renders the calm offline pill when the error message is the RN network-failure string', () => {
    forcedScreenState = { kind: 'error', message: 'Network request failed' };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const tree = HomeTabScreen(baseProps());

    const offlinePill = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-offline-pill');
    expect(offlinePill.length).toBe(1);
  });

  it('renders the generic error panel (NOT the offline pill) for a non-network error message', () => {
    forcedScreenState = { kind: 'error', message: 'unknown_error' };
    const { HomeTabScreen } = require('./HomeTabScreen');
    const tree = HomeTabScreen(baseProps());

    const offlinePill = findAll(tree, (el) => (el.props as Record<string, unknown>).testID === 'home-offline-pill');
    expect(offlinePill.length).toBe(0);
  });
});
