/**
 * CalendarTabScreen — SUPERSEDED by HomeTabScreen (v2 bottom-tab-navigation-design.md §3).
 *
 * @deprecated v2 (bottom-tab-navigation-design.md v2.1):
 *   - Dashboard content (StageBanner, ProgressBar, etc.) moved to HomeTabScreen.tsx
 *   - CalendarScreen is now rendered DIRECTLY in BottomTabNavigator (Tab 4, §3A).
 *   - LangToggle + gear ⚙ moved to HomeTabScreen top bar (§3.2).
 *   - Snapshot-population path (loadProfile + useProfileSnapshotSetter) moved to HomeTabScreen.
 *   - DoctorReport entry row added to HomeTabScreen (§3.3).
 *   This file is kept for reference and to avoid breaking any direct imports from
 *   calendarTabSnapshotBuilder.ts / calendarDashboardSections.ts tests.
 *   DO NOT render CalendarTabScreen in BottomTabNavigator — use HomeTabScreen + CalendarScreen.
 *
 * Original doc:
 * CalendarTabScreen — Calendar tab content (dashboard header + CalendarScreen).
 *
 * This screen replaces HomeScreen as the primary landing surface.
 * It is rendered as the 'Calendar' tab inside BottomTabNavigator.
 *
 * Responsibilities:
 *   1. Profile GET + lifecycle branching (formerly HomeScreen)
 *   2. Updates PregnancyProfileContext via useProfileSnapshotSetter so that
 *      non-tab screens (KickCount*, Settings, DoctorPdf, Suggestions) keep
 *      their props — design-reviewer's #1 build risk resolved.
 *   3. Renders the dashboard sections above CalendarScreen per §3.3:
 *        - Top bar: month nav stub · ⚙ gear · [TH|EN] toggle
 *        - Pregnant wk<32: stage banner → consent nudge* → suggestion† → progress → days-to-due
 *        - Pregnant wk≥32: stage banner → consent nudge* → kick-count card → suggestion† → progress → days-to-due
 *        - Postpartum: pp banner → PostpartumDayCard → consent nudge* → suggestion† → history link
 *   4. Screen states (§6A): loading skeleton, error+retry, needs-onboarding → reset to ProfileSetup
 *
 * Navigation callbacks (all from BottomTabNavigator via root stack navigation):
 *   onLogout         → performLogout + reset to Welcome
 *   onNeedsProfile   → reset to ProfileSetup (suppresses tab bar — ProfileSetup is a root screen)
 *   onBirthEvent(v)  → navigate to BirthEvent (T3 only)
 *   onSettings       → navigate to Settings
 *   onSuggestions    → navigate to Suggestions
 *   onKickCount      → navigate to KickCountHome (pregnant wk≥32 card tapped)
 *   onKickCountHistory → navigate directly to KickCountHistory (postpartum link)
 *   onAddAppointment, onEditAppointment, onAddReminder, onEditReminder, onAddCapture
 *                    → passed through to CalendarScreen
 *
 * Design tokens: same as HomeScreen (design-system.md §1–§5).
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
import { CalendarScreen } from '../calendar/CalendarScreen';
import { buildAddCaptureParams } from '../calendar/calendarAddCaptureHandler';
import { resolveSuggestionAction } from './calendarTabSuggestionRouting';
import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CalendarTabScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Route through performLogout + reset to Welcome on session expiry. */
  onLogout: () => void;
  /** Reset to ProfileSetup (GET 404). Tab bar suppressed because ProfileSetup is a root screen. */
  onNeedsProfile: () => void;
  /** Navigate to BirthEvent (T3 only). Passes current profile version for If-Match header. */
  onBirthEvent: (profileVersion: number) => void;
  /** Navigate to SettingsScreen (gear ⚙ in top bar). */
  onSettings: () => void;
  /** Navigate to SuggestionFlowScreen ("View all" from suggestion banner). */
  onSuggestions?: () => void;
  /** Navigate to KickCountHomeScreen (pregnant wk≥32 card tapped). */
  onKickCount?: () => void;
  /**
   * Navigate directly to KickCountHistoryScreen (postpartum history link §4.3).
   * Bypasses KickCountHomeScreen — history-only entry point.
   */
  onKickCountHistory?: () => void;
  /**
   * Switch to the Supplies tab (suggestion banner CTA for captureTarget='supplies').
   * Wired from BottomTabNavigator via tab navigation.
   */
  onSupplies?: () => void;
  /**
   * Switch to the Calendar tab capture flow (suggestion CTA for appointment /
   * medication / self_log captureTargets). In practice the user is already on
   * the Calendar tab, so this is a no-op scroll-to-top or refresh action.
   */
  onCalendar?: () => void;
  // Calendar sub-screen navigation (passed through to CalendarScreen):
  onAddAppointment?: () => void;
  onEditAppointment?: (itemId: string) => void;
  onAddReminder?: () => void;
  onEditReminder?: (reminderId: string) => void;
  onAddCapture?: (loggedAtDate: string) => void;
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'pregnant'; profile: PregnancyProfile; ga: GestationalAge }
  | { kind: 'postpartum'; profile: PregnancyProfile; pp: PostpartumAge }
  | { kind: 'needs-onboarding' }
  | { kind: 'error'; message: string };

// ─── Stage glyph helpers ──────────────────────────────────────────────────────

const STAGE_GLYPHS: Record<Stage, string> = {
  T1: '🌱',
  T2: '🌿',
  T3: '🌳',
};

// ─── Language toggle ──────────────────────────────────────────────────────────

function LangToggle(): React.JSX.Element {
  const { locale, setLocale } = useT();
  const label = locale === 'th' ? 'EN' : 'ไทย';
  const a11y = locale === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย';
  return (
    <TouchableOpacity
      style={toggleStyles.btn}
      onPress={() => setLocale(locale === 'th' ? 'en' : 'th')}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={toggleStyles.text}>{label}</Text>
    </TouchableOpacity>
  );
}

const toggleStyles = StyleSheet.create({
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    backgroundColor: '#FFFFFF',
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    color: '#5F4A52',
    letterSpacing: 0.3,
  },
});

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
  const stageGlyph = STAGE_GLYPHS[stage];

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
      <View style={bannerStyles.glyphDisc} accessibilityElementsHidden={true}>
        <Text style={bannerStyles.glyph}>{stageGlyph}</Text>
      </View>
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 16,
    gap: 12,
  },
  glyphDisc: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FBEDEE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  glyph: { fontSize: 22, lineHeight: 28 },
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
    borderRadius: 999,
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
      <View style={ppBannerStyles.glyphDisc} accessibilityElementsHidden={true}>
        <Text style={ppBannerStyles.glyph}>{'🍃'}</Text>
      </View>
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
    backgroundColor: '#EBF2EC',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#C3D9C6',
    padding: 16,
    gap: 12,
  },
  glyphDisc: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#C3D9C6',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  glyph: { fontSize: 22, lineHeight: 28 },
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#C3D9C6',
    padding: 24,
    alignItems: 'center',
  },
  number: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 56,
    lineHeight: 68,
    color: '#3D6647',
  },
  label: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#4A7A56',
    textAlign: 'center',
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

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarTabScreen({
  tokenStorage,
  apiBaseUrl,
  onLogout,
  onNeedsProfile,
  onBirthEvent,
  onSettings,
  onSuggestions,
  onKickCount,
  onKickCountHistory,
  onSupplies,
  onCalendar,
  onAddAppointment,
  onEditAppointment,
  onAddReminder,
  onEditReminder,
  onAddCapture,
}: CalendarTabScreenProps): React.JSX.Element {
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

  const loadProfile = useCallback(async () => {
    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken;
    if (!accessToken) {
      onLogout();
      return;
    }

    // Load cached consent state first (§4.5.4 B1 pattern from HomeScreen)
    await consentStore.loadFromStorage();
    await suggestionStore.loadFromStorage();

    try {
      const consentClient = createConsentApiClient(apiBaseUrl);
      const consentsResult = await consentClient.getConsents(accessToken);
      if (consentsResult.ok) {
        consentStore.hydrate(consentsResult.page.items);
      }
    } catch {
      // network error — cached consent state preserved
    }

    const client = createPregnancyClient(apiBaseUrl);
    const result = await client.getProfile(accessToken, localCivilToday());

    if (result.ok) {
      const { profile } = result;
      const todayCivil = localCivilToday();
      if (profile.lifecycle === 'postpartum' && profile.birthDate) {
        loadedBirthDate.current = profile.birthDate;
        loadedEdd.current = null;
        const pp = recomputeFromBirthDate(profile.birthDate);
        setState({ kind: 'postpartum', profile, pp });
        // Lift snapshot into PregnancyProfileContext so non-tab screens keep their props
        setSnapshot(buildCalendarTabSnapshot({
          profile,
          ga: null,
          generalHealthConsented: consentStore.isGranted('general_health'),
          todayCivil,
        }));
      } else {
        loadedEdd.current = profile.edd;
        loadedBirthDate.current = null;
        const ga = recomputeFromEdd(profile.edd);
        setState({ kind: 'pregnant', profile, ga });
        setSnapshot(buildCalendarTabSnapshot({
          profile,
          ga,
          generalHealthConsented: consentStore.isGranted('general_health'),
          todayCivil,
        }));
      }
    } else if (result.status === 404) {
      setState({ kind: 'needs-onboarding' });
    } else {
      setState({ kind: 'error', message: result.message });
    }
  }, [tokenStorage, apiBaseUrl, onLogout, recomputeFromEdd, recomputeFromBirthDate, setSnapshot]);

  // Re-GET on every focus (AC-8 from HomeScreen: ensures stale EDD is healed after ProfileEdit)
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
      // Drain queued consent POSTs on foreground (B2 §4.2.4)
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

  // ─── Top bar (all states) ──────────────────────────────────────────────────

  function renderTopBar(): React.JSX.Element {
    return (
      <View style={styles.topBar}>
        <View style={styles.topBarSpacer} />
        <LangToggle />
        <TouchableOpacity
          style={styles.gearBtn}
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel={t('home.settingsA11y')}
          testID="calendar-tab-settings-btn"
        >
          {/* §9: gear ⚙ replaces ☰ hamburger — matches settings affordance correctly */}
          <Text style={styles.gearIcon}>⚙</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Loading (§6A state 1: tab bar visible) ───────────────────────────────

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        {renderTopBar()}
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
        {renderTopBar()}
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

  // ─── Needs-onboarding (§6A state 3: tab bar suppressed via root-stack reset) ─
  // useEffect above calls onNeedsProfile() → navigation.reset to ProfileSetup
  // (a root-stack screen). The tab navigator is never mounted during onboarding,
  // so the tab bar is naturally absent. Show skeleton while transitioning.

  if (state.kind === 'needs-onboarding') {
    return (
      <SafeAreaView style={styles.container}>
        {renderTopBar()}
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Derived consent state ────────────────────────────────────────────────

  const generalHealthGranted = consentStore.isGranted('general_health');
  void suggestionTick; // lint: tick is accessed via closure below

  function handleResolveSuggestionAction(captureTarget: import('../suggestion/types').CaptureTarget): () => void {
    return resolveSuggestionAction(captureTarget, { onKickCount, onSupplies, onCalendar });
  }



  function handleSuggestionDismiss(key: SuggestionKey): void {
    suggestionStore.dismiss(key);
    setSuggestionTick((n) => n + 1);
  }

  // ─── CalendarScreen navigation wiring ────────────────────────────────────

  function handleAddAppointment(): void {
    onAddAppointment?.();
  }
  function handleEditAppointment(itemId: string): void {
    onEditAppointment?.(itemId);
  }
  function handleAddReminder(): void {
    onAddReminder?.();
  }
  function handleEditReminder(reminderId: string): void {
    onEditReminder?.(reminderId);
  }
  function handleAddCapture(loggedAtDate: string): void {
    onAddCapture?.(loggedAtDate);
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
        {renderTopBar()}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Postpartum banner */}
          <PostpartumBanner profile={profile} pp={pp} />
          {/* PostpartumDayCard — BEFORE consent/suggestion zone (spec §3.3 hero pair) */}
          {sections.showPostpartumDayCard && <PostpartumDayCard pp={pp} />}
          {/* Consent nudge (compliance-critical, mutually exclusive with suggestion) */}
          {sections.showConsentNudge && (
            <TouchableOpacity
              testID="consent-home-health-logging-nudge-banner"
              style={styles.consentNudgeBanner}
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel={t('consent.home.health_nudge_banner')}
            >
              <Text style={styles.consentNudgeBannerText}>
                {t('consent.home.health_nudge_banner')}
              </Text>
            </TouchableOpacity>
          )}
          {/* Suggestion banner (only when consented + offerable) */}
          {sections.showSuggestionBanner && ppTopSuggestion && (
            <SuggestionBanner
              topSuggestion={ppTopSuggestion}
              onAction={handleResolveSuggestionAction(ppTopSuggestion.captureTarget)}
              onDismiss={() => handleSuggestionDismiss(ppTopSuggestion.key)}
              onViewAll={onSuggestions}
            />
          )}
          {/* Quiet kick-count history link (always visible postpartum, §4.3) */}
          {sections.showPostpartumHistoryLink && (
            <TouchableOpacity
              testID="calendar-tab-kick-history-link"
              style={styles.historyLink}
              onPress={() => onKickCountHistory?.()}
              accessibilityRole="link"
              accessibilityLabel={t('kick.historyLink')}
            >
              <Text style={styles.historyLinkText}>{t('kick.historyLink')}</Text>
            </TouchableOpacity>
          )}
          {/* CalendarScreen (month grid + day detail) */}
          <CalendarScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onAddAppointment={handleAddAppointment}
            onEditAppointment={handleEditAppointment}
            onAddReminder={handleAddReminder}
            onEditReminder={handleEditReminder}
            onAddCapture={handleAddCapture}
          />
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
      {renderTopBar()}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Stage banner (T1/T2/T3) */}
        {sections.showStageBanner && (
          <StageBanner
            profile={profile}
            ga={ga}
            onBirthEvent={() => onBirthEvent(profile.version)}
          />
        )}
        {/* Consent nudge (compliance-critical, floats above kick-count card) */}
        {sections.showConsentNudge && (
          <TouchableOpacity
            testID="consent-home-health-logging-nudge-banner"
            style={styles.consentNudgeBanner}
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel={t('consent.home.health_nudge_banner')}
          >
            <Text style={styles.consentNudgeBannerText}>
              {t('consent.home.health_nudge_banner')}
            </Text>
          </TouchableOpacity>
        )}
        {/* Kick-count card (pregnant wk≥32, no consent gate, spec §4.2) */}
        {sections.showKickCountCard && (
          <TouchableOpacity
            testID="calendar-tab-kick-count-card"
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
        {/* CalendarScreen (month grid + day detail) */}
        <CalendarScreen
          tokenStorage={tokenStorage}
          apiBaseUrl={apiBaseUrl}
          onAddAppointment={handleAddAppointment}
          onEditAppointment={handleEditAppointment}
          onAddReminder={handleAddReminder}
          onEditReminder={handleEditReminder}
          onAddCapture={handleAddCapture}
        />
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
  // Top bar: [spacer] [TH|EN] [⚙] — right-aligned (spec §3.3)
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  topBarSpacer: { flex: 1 },
  gearBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  gearIcon: {
    // §9: real icon swap ☰ → ⚙
    fontSize: 20,
    color: '#5F4A52',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, gap: 16 },
  content: { flex: 1, padding: 24 },

  section: { gap: 8 },
  sectionLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52',
  },

  daysCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 24,
    alignItems: 'center',
  },
  daysNumber: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 56,
    lineHeight: 68,
    color: '#3A2A30',
  },
  daysLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    textAlign: 'center',
  },
  overdueLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
    textAlign: 'center',
  },

  // Kick-count card (pregnant wk≥32, spec §4.2 — rose/50 bg, warm and inviting)
  kickCountCard: {
    backgroundColor: '#FBEDEE', // rose/50
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F4D9DC', // rose/100
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

  // Consent limited-mode nudge banner
  consentNudgeBanner: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#A8505A', // rose/600
    borderRadius: 10,
    alignItems: 'center',
  },
  consentNudgeBannerText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
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
