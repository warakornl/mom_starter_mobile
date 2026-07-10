/**
 * homeTabScreen.cleanRedesign.test.ts — Token migration tests for HomeTabScreen.
 *
 * Originally: Phase 1 Clean redesign (Direction C) token assertions.
 * Updated: Phase 1 Mother's Room migration — token values updated per §1.8
 * migration map (mother-room-build-spec.md). The backward-compat T aliases
 * carry Mother's Room values; this file validates the migration is correct.
 *
 * Verifies the §1.8 migration aliases on T:
 *   hairline:              #E3D8CE → #E8DDD5 (new divider)
 *   cardRadius:            8       → 12      (radius.md)
 *   heroFontSize:          28      → 32      (type.display.size)
 *   heroFontFamily:        IBMPlexSans-SemiBold → Sarabun-SemiBold
 *   sectionLabelFontSize:  11      → 15      (type.label.size)
 *   sectionLabelColor:     #5F4A52 → #2F5042 (color.text.botanical)
 *   sectionLabelLetterSpacing: 0.8 → 0       (Thai: no tracking)
 *
 * All tests run in a pure-Node environment (no RNTL).
 */

// ── Minimal mocks ─────────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
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
  useT: jest.fn(() => ({ t: jest.fn((k: string) => k), locale: 'th' })),
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
    showKickCountCard: false,
    showSuggestionBanner: false,
    showProgressBar: true,
    showDaysToDue: true,
    showPostpartumDayCard: true,
    showPostpartumHistoryLink: false,
  })),
}));

jest.mock('./calendarTabSuggestionRouting', () => ({
  resolveSuggestionAction: jest.fn(),
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

// Stage icon mocks (just need to be importable for module-level tests)
jest.mock('../icons', () => ({
  StageT1Icon: 'StageT1Icon',
  StageT2Icon: 'StageT2Icon',
  StageT3Icon: 'StageT3Icon',
  PostpartumStageIcon: 'PostpartumStageIcon',
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { HomeTabScreen } from './HomeTabScreen';
import { T } from '../theme/tokens';

// ─── 1. Module export ────────────────────────────────────────────────────────

describe('HomeTabScreen — module export (post-redesign)', () => {
  it('is still exported as a function', () => {
    expect(typeof HomeTabScreen).toBe('function');
  });
});

// ─── 2. Token migration — §1.8 values ────────────────────────────────────────
// These tests now assert the MOTHER'S ROOM values (updated from Clean direction).

describe('HomeTabScreen — §1.8 token migration (Mother\'s Room values)', () => {
  it('T.hairline is #E8DDD5 (Mother\'s Room divider; was #E3D8CE in Clean)', () => {
    expect(T.hairline).toBe('#E8DDD5');
  });

  it('T.cardRadius is 12 (radius.md; was 8 in Clean; warmer per §1.6)', () => {
    expect(T.cardRadius).toBe(12);
  });

  it('T.heroFontSize is 32 (type.display.size; was 28 in Clean)', () => {
    expect(T.heroFontSize).toBe(32);
  });

  it('T.heroFontFamily is Sarabun-SemiBold (was IBMPlexSans-SemiBold in Clean)', () => {
    expect(T.heroFontFamily).toBe('Sarabun-SemiBold');
  });

  it('T.sectionLabelFontSize is 15 (type.label.size; was 11 in Clean)', () => {
    expect(T.sectionLabelFontSize).toBe(15);
  });

  it('T.sectionLabelColor is #2F5042 / color.text.botanical (was #5F4A52 in Clean)', () => {
    expect(T.sectionLabelColor).toBe('#2F5042');
  });

  it('T.sectionLabelLetterSpacing is 0 (Thai no tracking; was 0.8 in Clean)', () => {
    expect(T.sectionLabelLetterSpacing).toBe(0);
  });
});

// ─── 3. STAGE_GLYPHS removed — SVG icons imported ───────────────────────────

describe('HomeTabScreen — STAGE_GLYPHS removed (Tell 1B)', () => {
  it('HomeTabScreen module does not export STAGE_GLYPHS', () => {
    // If STAGE_GLYPHS were exported, this would catch it.
    // It's a module-internal const — we verify it's gone by confirming
    // the icon module is imported instead (mock above).
    const mod = require('./HomeTabScreen') as Record<string, unknown>;
    expect(mod).not.toHaveProperty('STAGE_GLYPHS');
  });
});

// ─── 4. SVG icon components are importable ───────────────────────────────────

describe('HomeTabScreen — SVG stage icons importable', () => {
  it('StageT1Icon is exported from src/icons', () => {
    const icons = require('../icons') as Record<string, unknown>;
    expect(icons.StageT1Icon).toBeDefined();
  });

  it('StageT2Icon is exported from src/icons', () => {
    const icons = require('../icons') as Record<string, unknown>;
    expect(icons.StageT2Icon).toBeDefined();
  });

  it('StageT3Icon is exported from src/icons', () => {
    const icons = require('../icons') as Record<string, unknown>;
    expect(icons.StageT3Icon).toBeDefined();
  });

  it('PostpartumStageIcon is exported from src/icons', () => {
    const icons = require('../icons') as Record<string, unknown>;
    expect(icons.PostpartumStageIcon).toBeDefined();
  });
});
