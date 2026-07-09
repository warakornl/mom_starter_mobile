/**
 * HomeTabScreen — Home tab content (dashboard + DoctorReport entry row).
 *
 * v2 center tab (bottom-tab-navigation-design.md v2.1 §3, §3.3, §6A).
 *
 * Responsibilities:
 *   1. Profile GET + lifecycle branching (taken from CalendarTabScreen v1).
 *   2. Updates PregnancyProfileContext via useProfileSnapshotSetter() so that
 *      non-tab screens (KickCount*, Settings, DoctorPdf, Suggestions) keep
 *      their props — critical because initialRouteName='Home' means this screen
 *      mounts first and owns the full snapshot-population path.
 *   3. Renders dashboard sections per §3.3 (NO CalendarScreen embedded — v2):
 *        - Pregnant wk<32: stage banner → suggestion† → progress → days-to-due
 *        - Pregnant wk≥32: stage banner → kick-count card → suggestion† → progress → days-to-due
 *        - Postpartum: pp banner → PostpartumDayCard → suggestion† → history link
 *      All followed by the Doctor Report entry row (spec §3.3, always visible).
 *   4. Screen states (§6A): loading skeleton, error+retry, needs-onboarding → reset to ProfileSetup.
 *
 * Constraint (§6B): HomeTabScreen MUST NOT embed VirtualizedList, FlatList, or
 * CalendarScreen. It renders only simple card/row components in its own ScrollView.
 *
 * Navigation callbacks:
 *   onLogout             → performLogout + reset to Welcome (session expiry / no-token)
 *   onNeedsProfile       → reset to ProfileSetup (GET 404; tab bar suppressed)
 *   onBirthEvent(v)      → navigate to BirthEvent (T3 only)
 *   onSuggestions        → navigate to Suggestions
 *   onKickCount          → navigate to KickCountHome (pregnant wk≥32 card tapped)
 *   onKickCountHistory   → navigate directly to KickCountHistory (postpartum link)
 *   onSupplies           → switch to Supplies tab (suggestion CTA for captureTarget=supplies)
 *   onCalendar           → switch to Calendar tab (suggestion CTA for appointment/medication/self_log)
 *   onDoctorReport       → navigate to DoctorReport root-stack screen (entry row tapped)
 *
 * Security: never log accessToken or health fields (SD-9).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  AppState,
  type AppStateStatus,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { createPregnancyClient } from '../pregnancy/pregnancyApiClient';
import {
  computeGestationalAge,
  localCivilToday,
} from '../pregnancy/gestationalAge';
import { computePostpartumAge } from '../pregnancy/postpartumAge';
import type { GestationalAge, Stage } from '../pregnancy/gestationalAge';
import type { PostpartumAge } from '../pregnancy/postpartumAge';
import type { PregnancyProfile } from '../pregnancy/types';
import { useProfileSnapshotSetter } from '../pregnancy/PregnancyProfileContext';
import { useT } from '../i18n/LanguageContext';
import { formatCivilDate } from '../i18n/messages';
import { consentStore } from '../consent/consentStore';
import { createConsentApiClient } from '../consent/consentApiClient';
import { drainConsentQueue } from '../consent/consentSync';
import { getOfferable } from '../suggestion/suggestionEngine';
import { suggestionStore } from '../suggestion/suggestionStore';
import { SuggestionBanner } from '../suggestion/SuggestionBanner';
import type { SuggestionKey, OfferableSuggestion } from '../suggestion/types';
import { resolveCalendarDashboardSections } from './calendarDashboardSections';
import { resolveSuggestionAction } from './calendarTabSuggestionRouting';
import { loadProfileIntoSnapshot } from './homeTabSnapshotLoader';
import { T } from '../theme/tokens';
import {
  StageT1Icon,
  StageT2Icon,
  StageT3Icon,
  PostpartumStageIcon,
} from '../icons';
import { BabySizeSection } from '../home/BabySizeSection';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HomeTabScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Route through performLogout + reset to Welcome on session expiry. */
  onLogout: () => void;
  /** Reset to ProfileSetup (GET 404). Tab bar suppressed because ProfileSetup is a root screen. */
  onNeedsProfile: () => void;
  /** Navigate to BirthEvent (T3 only). Passes current profile version for If-Match header. */
  onBirthEvent: (profileVersion: number) => void;
  /** Navigate to SuggestionFlowScreen ("View all" from suggestion banner). */
  onSuggestions?: () => void;
  /** Navigate to KickCountHomeScreen (pregnant wk≥32 card tapped, spec §4.2). */
  onKickCount?: () => void;
  /**
   * Navigate directly to KickCountHistoryScreen (postpartum history link §4.3).
   * Bypasses KickCountHomeScreen — history-only entry point.
   */
  onKickCountHistory?: () => void;
  /**
   * Switch to the Supplies tab (suggestion banner CTA for captureTarget='supplies').
   */
  onSupplies?: () => void;
  /**
   * Switch to the Calendar tab (suggestion CTA for appointment/medication/self_log).
   */
  onCalendar?: () => void;
  /**
   * Navigate to DoctorReport root-stack screen (Doctor Report entry row tapped).
   * Spec §3.3, §8A.1: only called when snapshot !== null (§report-edd-guard).
   */
  onDoctorReport: () => void;
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'pregnant'; profile: PregnancyProfile; ga: GestationalAge }
  | { kind: 'postpartum'; profile: PregnancyProfile; pp: PostpartumAge }
  | { kind: 'needs-onboarding' }
  | { kind: 'error'; message: string };

// ─── Stage icon helpers ───────────────────────────────────────────────────────
// Replaced emoji STAGE_GLYPHS with SVG icon components (Tell 1B, spec §2).

const STAGE_ICONS: Record<Stage, React.FC<{ color: string; size: number }>> = {
  T1: StageT1Icon,
  T2: StageT2Icon,
  T3: StageT3Icon,
};

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: number }): React.JSX.Element {
  const { t } = useT();
  const pct = Math.round(progress * 100);
  const fillFlex = Math.max(0, pct);
  const remainFlex = 100 - fillFlex;
  return (
    <View
      style={barStyles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={t('home.progressA11y', { pct })}
    >
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { flex: fillFlex }]} />
        {remainFlex > 0 && (
          <View style={[barStyles.remain, { flex: remainFlex }]} />
        )}
      </View>
      <Text style={barStyles.label}>{`${pct}%`}</Text>
    </View>
  );
}

const barStyles = StyleSheet.create({
  container: { gap: 4 },
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#EBE1D9',
  },
  fill:   { height: 8, backgroundColor: '#A8505A' },
  remain: { height: 8, backgroundColor: '#EBE1D9' },
  label: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 13,
    color: '#5F4A52',
    textAlign: 'right',
  },
});

// ─── Pregnant stage banner ────────────────────────────────────────────────────

function StageBanner({
  profile,
  ga,
  onBirthEvent,
}: {
  profile: PregnancyProfile;
  ga: GestationalAge;
  onBirthEvent: () => void;
}): React.JSX.Element {
  const { t, locale } = useT();
  const stage = ga.currentStage;
  const stageName = t(`stage.${stage}` as 'stage.T1' | 'stage.T2' | 'stage.T3');
  const StageIcon = STAGE_ICONS[stage];

  const weekLabel = ga.suppressDayDisplay
    ? t('home.weekDisplay', { n: ga.displayedWeek })
    : ga.gestationalDay > 0
      ? t('home.weekDisplayDays', { n: ga.displayedWeek, d: ga.gestationalDay })
      : t('home.weekDisplay', { n: ga.displayedWeek });

  const isOverdue = ga.daysRemaining < 0;
  const isT3 = stage === 'T3';

  const deliveryWindowText = t('home.deliveryWindow');
  const overdueSublineText = t('home.overdueSubline');
  const bannerA11yLabel = `${stageName} ${weekLabel}${ga.deliveryWindowActive ? ` ${deliveryWindowText}` : ''}${isOverdue ? ` ${overdueSublineText}` : ''}`;

  const eddLineText = t('home.eddLine', {
    date: formatCivilDate(profile.edd, locale),
    days: ga.daysRemaining,
  });

  return (
    <View
      testID="home-week-hero"
      style={bannerStyles.card}
      accessibilityRole="text"
      accessibilityLabel={bannerA11yLabel}
    >
      {/* Tell 1B: SVG stage icon replaces emoji glyphDisc (spec §2) */}
      <StageIcon color="#A8505A" size={28} />
      <View style={bannerStyles.textCol}>
        <View style={bannerStyles.stageLine} accessibilityElementsHidden={true}>
          <Text style={bannerStyles.stageLabel}>{stageName}</Text>
          <Text style={bannerStyles.dot}>{' · '}</Text>
          <Text style={bannerStyles.weekLabel}>{weekLabel}</Text>
          {ga.deliveryWindowActive && (
            <View style={bannerStyles.deliveryChip} accessibilityRole="text" accessibilityLabel={deliveryWindowText}>
              <Text style={bannerStyles.deliveryChipText}>{deliveryWindowText}</Text>
            </View>
          )}
        </View>
        {isOverdue && (
          <Text style={bannerStyles.overdueLine} accessibilityElementsHidden={true}>
            {overdueSublineText}
          </Text>
        )}
        {!isOverdue && (
          <Text style={bannerStyles.eddLine} accessibilityElementsHidden={true}>
            {eddLineText}
          </Text>
        )}
        {isT3 && (
          <TouchableOpacity
            testID="home-birth-cta"
            style={bannerStyles.birthCta}
            onPress={onBirthEvent}
            accessibilityRole="button"
            accessibilityLabel={t('home.birthCtaA11y')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={bannerStyles.birthCtaText}>{t('home.birthCta')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: T.cardRadius,    // Tell 2: 20→8
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 16,
    gap: 12,
  },
  // Tell 1B: glyphDisc + glyph removed (SVG icon renders directly in row)
  textCol: { flex: 1, gap: 4 },
  stageLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  stageLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
  },
  dot: { fontFamily: 'IBMPlexSans-Regular', fontSize: 18, color: '#94818A' },
  weekLabel: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 16,
    lineHeight: 24,
    color: '#3A2A30',
  },
  deliveryChip: {
    backgroundColor: '#F4D9DC',
    borderRadius: T.cardRadius,   // Tell 4: 999→8 mandatory T.cardRadius (spec §1.2)
    borderWidth: 1,
    borderColor: T.hairline,      // Tell 6: hairline border (spec §1.2 single-source)
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  deliveryChipText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    color: '#8E3A44',
  },
  overdueLine: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#5F4A52',
  },
  eddLine: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#94818A',
  },
  birthCta: {
    alignSelf: 'flex-start',
    marginTop: 4,
    minHeight: 32,
    justifyContent: 'center',
  },
  birthCtaText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#8E3A44',
    textDecorationLine: 'underline',
  },
});

// ─── Postpartum banner ────────────────────────────────────────────────────────

function PostpartumBanner({ profile, pp }: { profile: PregnancyProfile; pp: PostpartumAge }): React.JSX.Element {
  const { t, locale } = useT();
  let ageLabel: string;
  if (pp.postpartumWeek < 1) {
    ageLabel = t('home.babyAgeDays', { n: pp.postpartumDays });
  } else if (pp.postpartumDay === 0) {
    ageLabel = t('home.babyAgeWeeks', { n: pp.postpartumWeek });
  } else {
    ageLabel = t('home.babyAgeWeeksAndDays', { n: pp.postpartumWeek, d: pp.postpartumDay });
  }
  const stageLabel = t('home.postpartumStage', { n: pp.postpartumWeek });
  const birthDateFormatted = profile.birthDate ? formatCivilDate(profile.birthDate, locale) : '';
  return (
    <View
      testID="home-postpartum-banner"
      style={ppBannerStyles.card}
      accessibilityRole="text"
      accessibilityLabel={`${stageLabel} — ${ageLabel}`}
    >
      {/* Tell 1C: SVG PostpartumStageIcon replaces emoji glyphDisc (spec §2) */}
      <PostpartumStageIcon color="#4C6B57" size={28} />
      <View style={ppBannerStyles.textCol}>
        <Text style={ppBannerStyles.stageLabel} accessibilityElementsHidden={true}>{stageLabel}</Text>
        <Text style={ppBannerStyles.ageLabel}>{ageLabel}</Text>
        {birthDateFormatted ? (
          <Text style={ppBannerStyles.birthdateLine} accessibilityElementsHidden={true}>
            {t('home.birthDateLine', { date: birthDateFormatted })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const ppBannerStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF2EC',   // sage/50 — semantic status color, NOT changed
    borderRadius: T.cardRadius,   // Tell 2: 20→8
    borderWidth: 1,
    borderColor: '#C3D9C6',
    padding: 16,
    gap: 12,
  },
  // Tell 1C: glyphDisc + glyph removed (PostpartumStageIcon renders directly)
  textCol: { flex: 1, gap: 4 },
  stageLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    lineHeight: 20,
    color: '#3D6647',
  },
  ageLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 20,
    lineHeight: 28,
    color: '#3A2A30',
  },
  birthdateLine: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#4A7A56',
  },
});

// ─── Postpartum day-count card ────────────────────────────────────────────────

function PostpartumDayCard({ pp }: { pp: PostpartumAge }): React.JSX.Element {
  const { t } = useT();
  return (
    <View
      style={ppCardStyles.card}
      accessibilityRole="text"
      accessibilityLabel={`${pp.postpartumDays} ${t('home.daysSinceBirth')}`}
    >
      <Text style={ppCardStyles.number}>{pp.postpartumDays}</Text>
      <Text style={ppCardStyles.label}>{t('home.daysSinceBirth')}</Text>
    </View>
  );
}

const ppCardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: T.cardRadius,   // Tell 2: 20→8
    borderWidth: 1,
    borderColor: '#C3D9C6',
    padding: 24,
    alignItems: 'flex-start',     // Tell 3: center→left-align
  },
  number: {
    fontFamily: T.heroFontFamily, // Tell 3: IBMPlexMono-Medium→IBMPlexSans-SemiBold
    fontSize: T.heroFontSize,     // Tell 3: 56→28
    lineHeight: 36,               // Tell 3: 68→36
    color: '#3D6647',             // sage/700 — semantic, unchanged
  },
  label: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#4A7A56',
    // Tell 3: textAlign: 'center' removed (inherits flex-start from card)
  },
});

// ─── Skeleton (loading state §6A state 1) ─────────────────────────────────────

function Skeleton(): React.JSX.Element {
  const { t } = useT();
  return (
    <View style={skelStyles.container} accessibilityLabel={t('home.loading')}>
      <View style={skelStyles.bone} />
      <View style={[skelStyles.bone, { width: '60%' }]} />
      <View style={[skelStyles.bone, { height: 80, borderRadius: 20 }]} />
      <View style={[skelStyles.bone, { height: 60 }]} />
    </View>
  );
}

const skelStyles = StyleSheet.create({
  container: { gap: 12, marginTop: 16 },
  bone: {
    height: 24,
    borderRadius: 8,
    backgroundColor: '#FBF3EE',
    width: '100%',
  },
});

// ─── Doctor Report entry row (spec §3.3, always visible) ─────────────────────

function DoctorReportRow({ onPress }: { onPress: () => void }): React.JSX.Element {
  const { t } = useT();
  return (
    <TouchableOpacity
      testID="home-tab-doctor-report-row"
      style={reportRowStyles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('pdf.screen.builderTitle')}
    >
      <Text style={reportRowStyles.label}>{t('home.doctorReport')}</Text>
    </TouchableOpacity>
  );
}

const reportRowStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: T.cardRadius,   // Tell 2: 16→8
    borderWidth: 1,
    borderColor: '#EBE1D9',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#A8505A', // rose/600
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function HomeTabScreen({
  tokenStorage,
  apiBaseUrl,
  onLogout,
  onNeedsProfile,
  onBirthEvent,
  onSuggestions,
  onKickCount,
  onKickCountHistory,
  onSupplies,
  onCalendar,
  onDoctorReport,
}: HomeTabScreenProps): React.JSX.Element {
  const { t } = useT();
  const setSnapshot = useProfileSnapshotSetter();

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [suggestionTick, setSuggestionTick] = useState(0);

  const loadedEdd = useRef<string | null>(null);
  const loadedBirthDate = useRef<string | null>(null);

  const recomputeFromEdd = useCallback((edd: string): GestationalAge => {
    return computeGestationalAge(edd, localCivilToday());
  }, []);

  const recomputeFromBirthDate = useCallback((birthDate: string): PostpartumAge => {
    return computePostpartumAge(birthDate, localCivilToday());
  }, []);

  /**
   * loadProfile — GET /v1/pregnancy-profile and update snapshot in context.
   *
   * This is the full snapshot-population path (spec §3 build risk):
   *   1. Load cached consent + suggestions
   *   2. Fetch latest consents from API
   *   3. Delegate to loadProfileIntoSnapshot (pure async — testable in Node)
   *      which handles: no-token→onLogout, 200→setSnapshot, 404→onNeedsProfile,
   *      401→onLogout, error→setState(error)
   *
   * Called on mount via useFocusEffect so the snapshot is populated on every
   * tab focus (re-GET heals stale EDD after ProfileEdit — AC-8).
   *
   * The critical setSnapshot path is tested in homeTabSnapshotLoader.test.ts.
   */
  const loadProfile = useCallback(async () => {
    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken ?? null;

    // Load cached consent state first
    await consentStore.loadFromStorage();
    await suggestionStore.loadFromStorage();

    try {
      const consentClient = createConsentApiClient(apiBaseUrl);
      const consentsResult = await consentClient.getConsents(accessToken ?? '');
      if (accessToken && consentsResult.ok) {
        consentStore.hydrate(consentsResult.page.items);
      }
    } catch {
      // network error — cached consent state preserved
    }

    const todayCivil = localCivilToday();
    const client = createPregnancyClient(apiBaseUrl);

    // §3 build risk: delegate to the extracted pure function.
    // setSnapshot is called exactly once on 200 (both pregnant and postpartum).
    // 401 → onLogout; 404 → onNeedsProfile; errors → setState(error).
    await loadProfileIntoSnapshot({
      accessToken,
      getProfile: (token, today) => client.getProfile(token, today),
      todayCivil,
      generalHealthConsented: consentStore.isGranted('general_health'),
      setSnapshot,
      onLogout,
      onNeedsProfile: () => setState({ kind: 'needs-onboarding' }),
      onPregnant: (profile, ga) => {
        loadedEdd.current = profile.edd;
        loadedBirthDate.current = null;
        const freshGa = recomputeFromEdd(profile.edd);
        setState({ kind: 'pregnant', profile, ga: freshGa });
        void ga; // ga from loader is equivalent; freshGa used for ref consistency
      },
      onPostpartum: (profile, pp) => {
        loadedBirthDate.current = profile.birthDate ?? null;
        loadedEdd.current = null;
        const freshPp = recomputeFromBirthDate(profile.birthDate!);
        setState({ kind: 'postpartum', profile, pp: freshPp });
        void pp; // pp from loader is equivalent; freshPp used for ref consistency
      },
      onError: (message) => setState({ kind: 'error', message }),
    });
  }, [tokenStorage, apiBaseUrl, onLogout, recomputeFromEdd, recomputeFromBirthDate, setSnapshot]);

  // Re-GET on every focus (AC-8: ensures stale EDD is healed after ProfileEdit)
  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  useEffect(() => {
    if (state.kind === 'needs-onboarding') {
      onNeedsProfile();
    }
  }, [state.kind, onNeedsProfile]);

  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next !== 'active') return;
      // Drain queued consent POSTs on foreground
      void drainConsentQueue(tokenStorage, apiBaseUrl);
      if (loadedEdd.current) {
        const ga = recomputeFromEdd(loadedEdd.current);
        setState((prev) => prev.kind === 'pregnant' ? { ...prev, ga } : prev);
      } else if (loadedBirthDate.current) {
        const pp = recomputeFromBirthDate(loadedBirthDate.current);
        setState((prev) => prev.kind === 'postpartum' ? { ...prev, pp } : prev);
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [recomputeFromEdd, recomputeFromBirthDate, tokenStorage, apiBaseUrl]);

  // ─── Loading (§6A state 1: tab bar visible) ───────────────────────────────

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error + retry (§6A state 2: tab bar visible) ─────────────────────────

  if (state.kind === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorHeadline}>{t('home.errorHeadline')}</Text>
          <Text style={styles.errorSubline}>{t('home.errorSubline')}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => void loadProfile()}
            accessibilityRole="button"
            accessibilityLabel={t('general.retry')}
          >
            <Text style={styles.retryBtnText}>{t('general.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Needs-onboarding (§6A state 3: tab bar suppressed via root-stack reset)
  // useEffect above calls onNeedsProfile() → navigation.reset to ProfileSetup.

  if (state.kind === 'needs-onboarding') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Derived consent state ────────────────────────────────────────────────

  const generalHealthGranted = consentStore.isGranted('general_health');
  void suggestionTick; // lint: tick accessed via closure below

  function handleResolveSuggestionAction(captureTarget: import('../suggestion/types').CaptureTarget): () => void {
    return resolveSuggestionAction(captureTarget, { onKickCount, onSupplies, onCalendar });
  }

  function handleSuggestionDismiss(key: SuggestionKey): void {
    suggestionStore.dismiss(key);
    setSuggestionTick((n) => n + 1);
  }

  // ─── Postpartum mode ──────────────────────────────────────────────────────

  if (state.kind === 'postpartum') {
    const { profile, pp } = state;

    const ppOfferables: OfferableSuggestion[] = getOfferable(
      { lifecycle: 'postpartum', stage: null, gestationalWeek: 0, now: new Date() },
      suggestionStore.getState(),
    );
    const ppTopSuggestion = ppOfferables[0] ?? null;

    const sections = resolveCalendarDashboardSections({
      lifecycle: 'postpartum',
      gestationalWeek: 0,
      generalHealthGranted,
      hasOfferableSuggestion: ppTopSuggestion !== null,
    });

    return (
      <SafeAreaView style={styles.container}>
        {/* Constraint §6B: only simple card/row components — no VirtualizedList/CalendarScreen */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Postpartum banner + PostpartumDayCard (hero pair, spec §3.3) */}
          <PostpartumBanner profile={profile} pp={pp} />
          {sections.showPostpartumDayCard && <PostpartumDayCard pp={pp} />}
          {/* Baby size section — postpartum variant (always visible postpartum, design §1.2) */}
          {/* S6/S7: pp value MUST NOT be wired into any ad/product/feeding path (legal §5 CR-1) */}
          <BabySizeSection variant="postpartum" pp={pp} />
          {/* Suggestion banner (only when consented + offerable) */}
          {sections.showSuggestionBanner && ppTopSuggestion && (
            <SuggestionBanner
              topSuggestion={ppTopSuggestion}
              onAction={handleResolveSuggestionAction(ppTopSuggestion.captureTarget)}
              onDismiss={() => handleSuggestionDismiss(ppTopSuggestion.key)}
              onViewAll={onSuggestions}
            />
          )}
          {/* Quiet kick-count history link (always visible postpartum, spec §4.3) */}
          {sections.showPostpartumHistoryLink && (
            <TouchableOpacity
              testID="home-tab-kick-history-link"
              style={styles.historyLink}
              onPress={() => onKickCountHistory?.()}
              accessibilityRole="link"
              accessibilityLabel={t('kick.historyLink')}
            >
              <Text style={styles.historyLinkText}>{t('kick.historyLink')}</Text>
            </TouchableOpacity>
          )}
          {/* Doctor Report entry row — always visible (spec §3.3) */}
          <DoctorReportRow onPress={onDoctorReport} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Pregnant mode ────────────────────────────────────────────────────────

  const { profile, ga } = state;

  const pregnantOfferables: OfferableSuggestion[] = getOfferable(
    {
      lifecycle: 'pregnant',
      stage: ga.currentStage,
      gestationalWeek: ga.gestationalWeek,
      now: new Date(),
    },
    suggestionStore.getState(),
  );
  const pregnantTopSuggestion = pregnantOfferables[0] ?? null;

  const sections = resolveCalendarDashboardSections({
    lifecycle: 'pregnant',
    gestationalWeek: ga.gestationalWeek,
    generalHealthGranted,
    hasOfferableSuggestion: pregnantTopSuggestion !== null,
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Constraint §6B: only simple card/row components — no VirtualizedList/CalendarScreen */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Stage banner (T1/T2/T3) */}
        {sections.showStageBanner && (
          <StageBanner
            profile={profile}
            ga={ga}
            onBirthEvent={() => onBirthEvent(profile.version)}
          />
        )}
        {/* Baby size section — pregnant variant (visible wk≥5, hidden wk<5, design §1.1) */}
        {/* S6/S7: ga value MUST NOT be wired into any ad/product/feeding path (legal §5 CR-1) */}
        {ga.gestationalWeek >= 5 && (
          <BabySizeSection variant="pregnant" ga={ga} />
        )}
        {/* Kick-count card (pregnant wk≥32, no consent gate, spec §4.2) */}
        {sections.showKickCountCard && (
          <TouchableOpacity
            testID="home-tab-kick-count-card"
            style={styles.kickCountCard}
            onPress={() => onKickCount?.()}
            accessibilityRole="button"
            accessibilityLabel={t('kick.countCard')}
          >
            <Text style={styles.kickCountCardText}>{t('kick.countCard')}</Text>
          </TouchableOpacity>
        )}
        {/* Suggestion banner (only when consented + offerable, below kick-count card) */}
        {sections.showSuggestionBanner && pregnantTopSuggestion && (
          <SuggestionBanner
            topSuggestion={pregnantTopSuggestion}
            onAction={handleResolveSuggestionAction(pregnantTopSuggestion.captureTarget)}
            onDismiss={() => handleSuggestionDismiss(pregnantTopSuggestion.key)}
            onViewAll={onSuggestions}
          />
        )}
        {/* Progress bar */}
        {sections.showProgressBar && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('home.pregnancyProgress')}</Text>
            <ProgressBar progress={ga.progress} />
          </View>
        )}
        {/* Days-to-due card */}
        {sections.showDaysToDue && (
          <View style={styles.daysCard}>
            {ga.daysRemaining >= 0 ? (
              <>
                <Text style={styles.daysNumber}>{ga.daysRemaining}</Text>
                <Text style={styles.daysLabel}>{t('home.daysBeforeDue')}</Text>
              </>
            ) : (
              <Text style={styles.overdueLabel}>{t('home.overdueCard')}</Text>
            )}
          </View>
        )}
        {/* Doctor Report entry row — always visible (spec §3.3) */}
        <DoctorReportRow onPress={onDoctorReport} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, gap: 16 },
  content: { flex: 1, padding: 24 },

  section: { gap: 8 },
  sectionLabel: {
    fontFamily: T.sectionLabelFontFamily,         // Tell 7: unified to IBMPlexSans-SemiBold
    fontSize: T.sectionLabelFontSize,             // Tell 7: 15→11
    lineHeight: 16,
    letterSpacing: T.sectionLabelLetterSpacing,   // Tell 7: 0→0.8
    textTransform: 'uppercase',                   // Tell 7: uppercase (not in token per RN type constraints)
    color: T.sectionLabelColor,                   // Tell 7: #5F4A52 (already correct — kept)
    marginTop: 16,
    marginBottom: 8,
  },

  daysCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: T.cardRadius,   // Tell 2: 20→8
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 24,
    alignItems: 'flex-start',     // Tell 3: center→left-align
  },
  daysNumber: {
    fontFamily: T.heroFontFamily, // Tell 3: IBMPlexMono-Medium→IBMPlexSans-SemiBold
    fontSize: T.heroFontSize,     // Tell 3: 56→28
    lineHeight: 36,               // Tell 3: 68→36
    color: '#3A2A30',
  },
  daysLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    // Tell 3: textAlign: 'center' removed (inherits flex-start from daysCard)
  },
  overdueLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
  },

  // Kick-count card (pregnant wk≥32, spec §4.2) — Tell 6: rose/50→white surface
  kickCountCard: {
    backgroundColor: '#FFFFFF',     // Tell 6: rose/50→white surface
    borderRadius: T.cardRadius,     // Tell 6: 16→8 (mandatory T.cardRadius per spec §1.2)
    borderWidth: 1,
    borderColor: T.hairline,        // Tell 6: rose/100→T.hairline (mandatory per spec §1.2)
    padding: 16,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  kickCountCardText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#A8505A', // rose/600
  },

  // Quiet postpartum history link (spec §4.3: ink/soft, 14pt SemiBold, underline)
  historyLink: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  historyLinkText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#5F4A52', // ink/soft
    textDecorationLine: 'underline',
  },

  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  errorHeadline: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
    textAlign: 'center',
  },
  errorSubline: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    textAlign: 'center',
  },
  retryBtn: {
    height: 52,
    paddingHorizontal: 32,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
