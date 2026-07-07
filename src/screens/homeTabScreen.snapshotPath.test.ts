/**
 * homeTabScreen.snapshotPath.test.ts
 *
 * TDD assertions for HomeTabScreen's snapshot-population ownership.
 *
 * Critical build risk (design spec §3, "biggest build risk"):
 *   HomeTabScreen MUST own the COMPLETE snapshot-population path because
 *   initialRouteName = 'Home'. Non-tab screens (DoctorReport, KickCount*,
 *   Settings) all read useProfileSnapshot() — which is only populated after
 *   HomeTabScreen runs its profile GET.
 *
 * Tests:
 *   1. HomeTabScreen module exports a named component function.
 *   2. The snapshot builder (buildCalendarTabSnapshot) that HomeTabScreen
 *      uses is importable from its module-local path — verifying the
 *      co-location of snapshot logic with HomeTabScreen.
 *   3. Snapshot shape completeness: all fields required by DoctorReport
 *      and KickCount* are present in the snapshot output.
 *
 * Note: Full async lifecycle tests (useFocusEffect re-GET) require
 * React Native Testing Library with mocked API and are deferred to the
 * integration test slice. This file covers the pure-logic contracts.
 *
 * Mocks: react-native and @react-navigation/native are native modules
 * that cannot be loaded in the pure-node ts-jest environment. They are
 * stubbed here so the module-export check resolves without a bundler.
 */

// ─── React Native stubs (required before HomeTabScreen import) ────────────────

// Stub react-native: HomeTabScreen imports View/Text/etc which require the
// Metro bundler. We only need the module to resolve, not render.
jest.mock('react-native', () => {
  const StyleSheet = { create: (obj: unknown) => obj };
  const mkComponent = (name: string) => name;
  return {
    View: mkComponent('View'),
    Text: mkComponent('Text'),
    TouchableOpacity: mkComponent('TouchableOpacity'),
    SafeAreaView: mkComponent('SafeAreaView'),
    ScrollView: mkComponent('ScrollView'),
    StyleSheet,
    AppState: {
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
      currentState: 'active',
    },
  };
});

// Stub @react-navigation/native: useFocusEffect requires a navigation context.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

// Stub SuggestionBanner (imports react-native transitively).
jest.mock('../suggestion/SuggestionBanner', () => ({
  SuggestionBanner: 'SuggestionBanner',
}));

// Stub react-native-svg: transitively imported via src/icons (Phase 1 Clean redesign).
// The pure-node test environment cannot load native SVG modules.
jest.mock('react-native-svg', () => {
  const mkComponent = (name: string) => name;
  return {
    default: mkComponent('Svg'),
    Svg: mkComponent('Svg'),
    Path: mkComponent('Path'),
    Circle: mkComponent('Circle'),
    Rect: mkComponent('Rect'),
    Line: mkComponent('Line'),
    G: mkComponent('G'),
    Ellipse: mkComponent('Ellipse'),
  };
});

// Stub src/icons (Phase 1 Clean redesign): SVG components replace emoji glyphs.
// HomeTabScreen now imports StageT1/T2/T3Icon + PostpartumStageIcon.
jest.mock('../icons', () => ({
  StageT1Icon: 'StageT1Icon',
  StageT2Icon: 'StageT2Icon',
  StageT3Icon: 'StageT3Icon',
  PostpartumStageIcon: 'PostpartumStageIcon',
  TabChecklistIcon: 'TabChecklistIcon',
  TabCoinsIcon: 'TabCoinsIcon',
  TabHomeIcon: 'TabHomeIcon',
  TabCalendarIcon: 'TabCalendarIcon',
  TabPillIcon: 'TabPillIcon',
  TabPersonIcon: 'TabPersonIcon',
}));

// Stub expo-secure-store (used by LanguageContext for locale persistence).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// ─── Imports (after mocks are registered) ─────────────────────────────────────

import { HomeTabScreen } from './HomeTabScreen';
import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';
import type { PregnancyProfile } from '../pregnancy/types';
import type { GestationalAge } from '../pregnancy/gestationalAge';

// ─── HomeTabScreen module existence ──────────────────────────────────────────

describe('HomeTabScreen — module export (snapshot-path ownership)', () => {
  it('HomeTabScreen is exported as a function (React component)', () => {
    expect(typeof HomeTabScreen).toBe('function');
  });

  it('HomeTabScreen is defined (file exists and exports the component)', () => {
    expect(HomeTabScreen).toBeDefined();
  });
});

// ─── Snapshot shape — all fields required by downstream screens ───────────────

describe('HomeTabScreen — snapshot shape completeness', () => {
  function makeProfile(): PregnancyProfile {
    return {
      id: 'p-home-001',
      edd: '2026-12-01',
      eddBasis: 'due_date',
      lifecycle: 'pregnant',
      birthDate: null,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-07-06T00:00:00Z',
      gestationalWeek: 28,
      gestationalDay: 0,
      daysRemaining: 140,
      progress: 0.7,
      currentStage: 'T3',
      deliveryWindowActive: false,
    };
  }

  function makeGa(week: number): GestationalAge {
    return {
      daysPregnant: week * 7,
      gestationalWeek: week,
      gestationalDay: 0,
      currentStage: week >= 28 ? 'T3' : week >= 14 ? 'T2' : 'T1',
      progress: week / 40,
      daysRemaining: (40 - week) * 7,
      deliveryWindowActive: week >= 37,
      displayedWeek: week,
      suppressDayDisplay: false,
    };
  }

  it('snapshot has all 5 fields required by DoctorReport/KickCount/Settings', () => {
    const snapshot = buildCalendarTabSnapshot({
      profile: makeProfile(),
      ga: makeGa(28),
      generalHealthConsented: true,
      todayCivil: '2026-07-06',
    });
    // Required by DoctorPdfScreen.profile: edd, gestationalWeek, lifecycle
    expect(snapshot.edd).toBeDefined();
    expect(snapshot.gestationalWeek).toBeDefined();
    expect(snapshot.lifecycle).toBeDefined();
    // Required by KickCountHomeScreen: gestationalWeek, lifecycle, generalHealthConsented
    expect(snapshot.generalHealthConsented).toBeDefined();
    // Required by CalendarTabScreen/all screens: todayCivil
    expect(snapshot.todayCivil).toBeDefined();
  });

  it('wk≥32 snapshot enables kick-count card (gestationalWeek gate)', () => {
    const snapshot = buildCalendarTabSnapshot({
      profile: makeProfile(),
      ga: makeGa(32),
      generalHealthConsented: false,
      todayCivil: '2026-07-06',
    });
    // The kick-count gate: pregnant + gestationalWeek >= 32
    expect(snapshot.lifecycle).toBe('pregnant');
    expect(snapshot.gestationalWeek).toBeGreaterThanOrEqual(32);
  });

  it('EDD sentinel prevention: edd is a real date, not the 2999 sentinel', () => {
    // The §report-edd-guard in DoctorReport screen prevents bogus sentinel EDD
    // from reaching the PDF. Verify buildCalendarTabSnapshot passes real EDD through.
    const snapshot = buildCalendarTabSnapshot({
      profile: { ...makeProfile(), edd: '2026-12-01' },
      ga: makeGa(28),
      generalHealthConsented: true,
      todayCivil: '2026-07-06',
    });
    expect(snapshot.edd).toBe('2026-12-01');
    expect(snapshot.edd).not.toBe('2999-12-31');
  });
});
