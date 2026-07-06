/**
 * HomeScreen — Dashboard (Calendar Home).
 *
 * Implements calendar-home-ui.md §4 (screen states) and §6.1 (stage banner)
 * for BOTH lifecycles:
 *   pregnant   — gestational-age dashboard with T3 birth CTA
 *   postpartum — baby-age dashboard (sage/green tones)
 *
 * Screen states (calendar-home-ui §4):
 *   loading         — skeleton while checking profile
 *   needs-onboarding — 404 from GET /pregnancy-profile → ProfileSetup
 *   pregnant        — profile found, lifecycle === 'pregnant'
 *   postpartum      — profile found, lifecycle === 'postpartum'
 *   error           — unexpected API error
 *
 * i18n: all strings from useT() / catalog. Language toggle button in the
 * top-right area of the header.
 *
 * Date formatting: formatCivilDate from messages.ts (locale-aware).
 *
 * Offline: the stage banner re-derives locally from cached edd (pregnant) or
 * birthDate (postpartum) and the device-local civil date on every foreground
 * event and local midnight. No network is required once the anchor is known.
 *
 * Birth CTA placement (calendar-home-ui §6.1 / pregnancy-profile-ui §4.1):
 *   "ลูกคลอดแล้ว ›" is a quiet, small affordance inside the T3 stage banner
 *   only — never a standalone prominent card on the calendar surface.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1
 *   surface/page  #FFFFFF
 *   ink           #3A2A30
 *   ink/soft      #5F4A52
 *   ink/faint     #94818A
 *   rose/50       #FBEDEE
 *   rose/100      #F4D9DC
 *   rose/600      #A8505A  (primary button)
 *   rose/700      #8E3A44
 *   hairline      #EBE1D9
 *   sage/50       #EBF2EC  (postpartum bg tint)
 *   sage/600      #4A7A56  (postpartum accent)
 *   sage/700      #3D6647
 *
 * Security: NEVER log the accessToken or any health fields (birthDate, etc.).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { useT } from '../i18n/LanguageContext';
import { formatCivilDate } from '../i18n/messages';
import { shouldShowModule } from '../kickCount/kickCountLogic';
import { consentStore } from '../consent/consentStore';
import { createConsentApiClient } from '../consent/consentApiClient';
import { drainConsentQueue } from '../consent/consentSync';
import { getOfferable } from '../suggestion/suggestionEngine';
import { suggestionStore } from '../suggestion/suggestionStore';
import { SuggestionBanner } from '../suggestion/SuggestionBanner';
import type { SuggestionKey, CaptureTarget, OfferableSuggestion } from '../suggestion/types';
// Note: DoctorPdfButton, kickCountSyncStore, calendarSyncStore, supplySyncStore
// were used by the old inline DoctorPdfButton. They are no longer needed here —
// the DoctorPdfScreen reads from stores directly after navigation.

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HomeScreenProps {
  /** Shared secure token storage — cleared on logout. */
  tokenStorage: TokenStorage;
  /** API base URL for pregnancy profile GET. */
  apiBaseUrl: string;
  /** Navigate back to Welcome screen (resets the stack). */
  onLogout: () => void;
  /** Navigate to ProfileSetup when no profile exists (GET 404). */
  onNeedsProfile: () => void;
  /**
   * Navigate to BirthEventScreen (T3 only).
   * Passes the current profile version (for If-Match header).
   * Called from the T3 stage banner "ลูกคลอดแล้ว" affordance.
   */
  onBirthEvent: (profileVersion: number) => void;
  /**
   * Navigate to SuppliesScreen (offline-first supply checklist).
   * Optional — no-op if not provided (keeps existing snapshots/tests working).
   */
  onSupplies?: () => void;
  /**
   * Navigate to ExpensesScreen (offline-first monthly expense ledger).
   * Optional — no-op if not provided (keeps existing snapshots/tests working).
   */
  onExpenses?: () => void;
  /**
   * Navigate to CalendarScreen (month/agenda — appointments + reminders).
   * Optional — no-op if not provided (keeps existing snapshots/tests working).
   */
  onCalendar?: () => void;
  /**
   * Navigate to SettingsScreen (account menu — home for logout).
   * Optional — no-op if not provided (keeps existing snapshots/tests working).
   */
  onSettings?: () => void;
  /**
   * Navigate to KickCountHomeScreen (wk≥32 + pregnant gate applied here).
   * Optional — no-op if not provided.
   */
  onKickCount?: () => void;
  /**
   * B-1: Called after the pregnancy profile loads so the navigator can
   * derive gestationalWeek/edd/lifecycle for KickCount screens.
   * Optional — no-op if not provided.
   */
  onProfileLoaded?: (snapshot: ProfileSnapshot) => void;
  /**
   * Navigate to SuggestionFlowScreen (full stage-suggestion list).
   * Optional — when absent the "View all" link is hidden from the banner.
   */
  onSuggestions?: () => void;
  /**
   * Navigate to the DoctorPdfScreen (Builder→Preview→Share, spec §1–§5).
   * Replaces the inline DoctorPdfButton that was previously on HomeScreen.
   * Optional — no-op if not provided (keeps existing snapshot tests working).
   */
  onDoctorPdf?: () => void;
  /**
   * Navigate to MedicationPlanListScreen (bottom-nav tab — ยา / Plans).
   * Optional — no-op if not provided (keeps existing snapshot tests working).
   */
  onMedication?: () => void;
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
            <View
              style={bannerStyles.deliveryChip}
              accessibilityRole="text"
              accessibilityLabel={deliveryWindowText}
            >
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
  glyph: {
    fontSize: 22,
    lineHeight: 28,
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
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
  dot: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 18,
    color: '#94818A',
  },
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

function PostpartumBanner({
  profile,
  pp,
}: {
  profile: PregnancyProfile;
  pp: PostpartumAge;
}): React.JSX.Element {
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
  const birthDateFormatted = profile.birthDate
    ? formatCivilDate(profile.birthDate, locale)
    : '';

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
        <Text style={ppBannerStyles.stageLabel} accessibilityElementsHidden={true}>
          {stageLabel}
        </Text>
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
  glyph: {
    fontSize: 22,
    lineHeight: 28,
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
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

// ─── Skeleton (loading) ────────────────────────────────────────────────────────

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

export function HomeScreen({
  tokenStorage,
  apiBaseUrl,
  onLogout,
  onNeedsProfile,
  onBirthEvent,
  onSupplies,
  onExpenses,
  onCalendar,
  onKickCount,
  onSettings,
  onProfileLoaded,
  onSuggestions,
  onDoctorPdf,
  onMedication,
}: HomeScreenProps): React.JSX.Element {
  const { t } = useT();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  // Incremented on each suggestion dismiss so the banner re-evaluates the store.
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

    // B1 (§4.5.4): Load cached consent state FIRST so that a failing GET
    // (offline / 5xx) keeps the last-known granted state. A returning consented
    // user is NOT dropped to limited mode on a cold start without network.
    // Only a successful GET then merges fresh server data over the cache.
    // SECURITY: accessToken is NEVER logged.
    await consentStore.loadFromStorage();

    // Restore suggestion dismiss/snooze state from durable storage so that
    // dismissed suggestions don't reappear after an app restart.
    // Best-effort: if storage fails, state starts empty (all suggestions offered).
    await suggestionStore.loadFromStorage();

    try {
      const consentClient = createConsentApiClient(apiBaseUrl);
      const consentsResult = await consentClient.getConsents(accessToken);
      if (consentsResult.ok) {
        // Merges server records (latest grantedAt wins); also auto-persists
        consentStore.hydrate(consentsResult.page.items);
      }
      // GET failure → cached state from loadFromStorage() remains (§4.5.4)
    } catch {
      // network error — cached consent state preserved (§4.5.4)
    }

    const client = createPregnancyClient(apiBaseUrl);
    const result = await client.getProfile(accessToken, localCivilToday());

    if (result.ok) {
      const { profile } = result;

      if (profile.lifecycle === 'postpartum' && profile.birthDate) {
        loadedBirthDate.current = profile.birthDate;
        loadedEdd.current = null;
        const pp = recomputeFromBirthDate(profile.birthDate);
        setState({ kind: 'postpartum', profile, pp });
        // B-1: notify navigator of postpartum profile for KickCount screens
        onProfileLoaded?.({
          gestationalWeek: 0,
          edd: profile.edd,
          todayCivil: localCivilToday(),
          lifecycle: 'postpartum',
          generalHealthConsented: consentStore.isGranted('general_health'),
        });
      } else {
        loadedEdd.current = profile.edd;
        loadedBirthDate.current = null;
        const ga = recomputeFromEdd(profile.edd);
        setState({ kind: 'pregnant', profile, ga });
        // B-1: notify navigator of pregnant profile for KickCount screens
        onProfileLoaded?.({
          gestationalWeek: ga.gestationalWeek,
          edd: profile.edd,
          todayCivil: localCivilToday(),
          lifecycle: 'pregnant',
          generalHealthConsented: consentStore.isGranted('general_health'),
        });
      }
    } else if (result.status === 404) {
      setState({ kind: 'needs-onboarding' });
    } else {
      setState({ kind: 'error', message: result.message });
    }
  }, [tokenStorage, apiBaseUrl, onLogout, recomputeFromEdd, recomputeFromBirthDate]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (state.kind === 'needs-onboarding') {
      onNeedsProfile();
    }
  }, [state.kind, onNeedsProfile]);

  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next !== 'active') return;

      // B2 (§4.2.4): Drain any queued consent POSTs on foreground so that
      // consents that failed while offline are retried automatically.
      // Best-effort — drainConsentQueue never throws.
      void drainConsentQueue(tokenStorage, apiBaseUrl);

      if (loadedEdd.current) {
        const ga = recomputeFromEdd(loadedEdd.current);
        setState((prev) =>
          prev.kind === 'pregnant' ? { ...prev, ga } : prev,
        );
      } else if (loadedBirthDate.current) {
        const pp = recomputeFromBirthDate(loadedBirthDate.current);
        setState((prev) =>
          prev.kind === 'postpartum' ? { ...prev, pp } : prev,
        );
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [recomputeFromEdd, recomputeFromBirthDate, tokenStorage, apiBaseUrl]);

  // Logout now lives in SettingsScreen (reached via the ☰ menu button → Settings). The
  // shared performLogout runner there clears tokens + all health stores (PDPA 1.1).

  // ─── Loading ─────────────────────────────────────────────────────────────

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────

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

  if (state.kind === 'needs-onboarding') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Consent limited-mode derived value ──────────────────────────────────
  // Fail-closed: isGranted returns false when no record (no health data saved).
  const generalHealthGranted = consentStore.isGranted('general_health');

  // ─── Suggestion engine helpers ────────────────────────────────────────────
  // suggestionTick changes on each dismiss, causing the banner to re-evaluate.
  // void to suppress lint (tick is accessed via closure below).
  void suggestionTick;

  /**
   * Resolve the primary navigation action for a suggestion's captureTarget.
   * Deep-links to the most relevant screen per the spec's "primary action" rule.
   */
  function resolveSuggestionAction(captureTarget: CaptureTarget): () => void {
    switch (captureTarget) {
      case 'kick_count':
        return () => onKickCount?.();
      case 'supplies':
        return () => onSupplies?.();
      case 'appointment':
      case 'medication':
      case 'self_log':
      default:
        return () => onCalendar?.();
    }
  }

  function handleSuggestionDismiss(key: SuggestionKey): void {
    suggestionStore.dismiss(key);
    setSuggestionTick((n) => n + 1);
    // TODO (spec §2.2): show an undo toast using i18n keys
    //   suggestion.hidden.toast / suggestion.hidden.undo
    // that calls suggestionStore.reenable(key). Deferred: dismiss is recoverable
    // via the "View hidden" section in SuggestionFlowScreen (§3.1).
  }

  // ─── Postpartum mode ──────────────────────────────────────────────────────

  if (state.kind === 'postpartum') {
    const { profile, pp } = state;

    // Suggestion banner for postpartum (computed locally)
    const ppOfferables: OfferableSuggestion[] = getOfferable(
      { lifecycle: 'postpartum', stage: null, gestationalWeek: 0, now: new Date() },
      suggestionStore.getState(),
    );
    const ppTopSuggestion = ppOfferables[0] ?? null;

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerSpacer} />
          <LangToggle />
          {onSettings && (
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel={t('home.settingsA11y')}
              testID="home-settings-btn"
            >
              <Text style={styles.settingsIcon}>☰</Text>
            </TouchableOpacity>
          )}
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <PostpartumBanner profile={profile} pp={pp} />
          {/* ─── Priority 1: Consent limited-mode nudge (compliance-critical) ────
              Shown first when general_health is not granted (§4.3 first-run-consent.md).
              Routes to Settings where the user can manage permissions. */}
          {!generalHealthGranted && (
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
          {/* ─── Priority 2: Suggestion banner (design-system §5.3) ─────────────
              Shown only when ≥1 suggestion is offerable (AC-29) and the consent
              nudge is not present (compliance nudge takes priority). */}
          {generalHealthGranted && ppTopSuggestion && (
            <SuggestionBanner
              topSuggestion={ppTopSuggestion}
              onAction={resolveSuggestionAction(ppTopSuggestion.captureTarget)}
              onDismiss={() => handleSuggestionDismiss(ppTopSuggestion.key)}
              onViewAll={onSuggestions}
            />
          )}
          <PostpartumDayCard pp={pp} />
          {onSupplies && (
            <TouchableOpacity
              testID="home-supplies-shortcut"
              style={styles.suppliesBtn}
              onPress={onSupplies}
              accessibilityRole="button"
              accessibilityLabel={t('supplies.navTitle')}
            >
              <Text style={styles.suppliesBtnText}>{t('supplies.shortcutBtn')}</Text>
            </TouchableOpacity>
          )}
          {onExpenses && (
            <TouchableOpacity
              testID="home-expenses-shortcut"
              style={styles.expensesBtn}
              onPress={onExpenses}
              accessibilityRole="button"
              accessibilityLabel={t('expenses.navTitle')}
            >
              <Text style={styles.expensesBtnText}>{t('expenses.shortcutBtn')}</Text>
            </TouchableOpacity>
          )}
          {onCalendar && (
            <TouchableOpacity
              testID="home-calendar-shortcut"
              style={styles.calendarBtn}
              onPress={onCalendar}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.navTitle')}
            >
              <Text style={styles.calendarBtnText}>{t('calendar.shortcutBtn')}</Text>
            </TouchableOpacity>
          )}
          {/* B-1: KickCount entry — postpartum always visible (no week gate) */}
          {onKickCount && (
            <TouchableOpacity
              testID="home-kick-count-shortcut"
              style={styles.kickCountBtn}
              onPress={onKickCount}
              accessibilityRole="button"
              accessibilityLabel={t('kick.navTitle')}
            >
              <Text style={styles.kickCountBtnText}>{t('kick.navTitle')}</Text>
            </TouchableOpacity>
          )}
          {/* Doctor PDF Report — navigate to Builder→Preview→Share screen (spec §1–§5) */}
          {onDoctorPdf && (
            <TouchableOpacity
              testID="home-doctor-pdf-btn"
              style={styles.doctorPdfBtn}
              onPress={onDoctorPdf}
              accessibilityRole="button"
              accessibilityLabel={t('pdf.screen.navTitle')}
            >
              <Text style={styles.doctorPdfBtnText}>{t('pdf.screen.navTitle')}</Text>
            </TouchableOpacity>
          )}
          {/* Medication Plans — postpartum entry (medication-plan-ui.md §1) */}
          {onMedication && (
            <TouchableOpacity
              testID="home-medication-shortcut-postpartum"
              style={styles.medicationBtn}
              onPress={onMedication}
              accessibilityRole="button"
              accessibilityLabel={t('medication.navTitle')}
            >
              <Text style={styles.medicationBtnText}>{t('medication.tabLabel')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Pregnant mode ────────────────────────────────────────────────────────

  const { profile, ga } = state;

  // Suggestion banner for pregnant mode — computed from engine (local, fast)
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerSpacer} />
        <LangToggle />
        {onSettings && (
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel={t('home.settingsA11y')}
            testID="home-settings-btn"
          >
            <Text style={styles.settingsIcon}>☰</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <StageBanner
          profile={profile}
          ga={ga}
          onBirthEvent={() => onBirthEvent(profile.version)}
        />
        {/* ─── Priority 1: Consent limited-mode nudge (compliance-critical) ────
            Shown first when general_health is not granted (§4.3 first-run-consent.md).
            Routes to Settings where the user can manage permissions. */}
        {!generalHealthGranted && (
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
        {/* ─── Priority 2: Suggestion banner (design-system §5.3) ─────────────
            Only shown when consent is granted AND ≥1 suggestion is offerable.
            Consent nudge takes priority when not yet consented (compliance rule). */}
        {generalHealthGranted && pregnantTopSuggestion && (
          <SuggestionBanner
            topSuggestion={pregnantTopSuggestion}
            onAction={resolveSuggestionAction(pregnantTopSuggestion.captureTarget)}
            onDismiss={() => handleSuggestionDismiss(pregnantTopSuggestion.key)}
            onViewAll={onSuggestions}
          />
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('home.pregnancyProgress')}</Text>
          <ProgressBar progress={ga.progress} />
        </View>

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

        {onSupplies && (
          <TouchableOpacity
            testID="home-supplies-shortcut"
            style={styles.suppliesBtn}
            onPress={onSupplies}
            accessibilityRole="button"
            accessibilityLabel={t('supplies.navTitle')}
          >
            <Text style={styles.suppliesBtnText}>{t('supplies.shortcutBtn')}</Text>
          </TouchableOpacity>
        )}
        {onExpenses && (
          <TouchableOpacity
            testID="home-expenses-shortcut"
            style={styles.expensesBtn}
            onPress={onExpenses}
            accessibilityRole="button"
            accessibilityLabel={t('expenses.navTitle')}
          >
            <Text style={styles.expensesBtnText}>{t('expenses.shortcutBtn')}</Text>
          </TouchableOpacity>
        )}
        {onCalendar && (
          <TouchableOpacity
            testID="home-calendar-shortcut"
            style={styles.calendarBtn}
            onPress={onCalendar}
            accessibilityRole="button"
            accessibilityLabel={t('calendar.navTitle')}
          >
            <Text style={styles.calendarBtnText}>{t('calendar.shortcutBtn')}</Text>
          </TouchableOpacity>
        )}
        {/* B-1: KickCount entry — wk≥32 gate via shouldShowModule */}
        {onKickCount && shouldShowModule(ga.gestationalWeek, 'pregnant') && (
          <TouchableOpacity
            testID="home-kick-count-shortcut"
            style={styles.kickCountBtn}
            onPress={onKickCount}
            accessibilityRole="button"
            accessibilityLabel={t('kick.navTitle')}
          >
            <Text style={styles.kickCountBtnText}>{t('kick.navTitle')}</Text>
          </TouchableOpacity>
        )}
        {/* Doctor PDF Report — navigate to Builder→Preview→Share screen (spec §1–§5) */}
        {onDoctorPdf && (
          <TouchableOpacity
            testID="home-doctor-pdf-btn"
            style={styles.doctorPdfBtn}
            onPress={onDoctorPdf}
            accessibilityRole="button"
            accessibilityLabel={t('pdf.screen.navTitle')}
          >
            <Text style={styles.doctorPdfBtnText}>{t('pdf.screen.navTitle')}</Text>
          </TouchableOpacity>
        )}
        {/* Medication Plans — bottom-nav tab entry (medication-plan-ui.md §1) */}
        {onMedication && (
          <TouchableOpacity
            testID="home-medication-shortcut"
            style={styles.medicationBtn}
            onPress={onMedication}
            accessibilityRole="button"
            accessibilityLabel={t('medication.navTitle')}
          >
            <Text style={styles.medicationBtnText}>{t('medication.tabLabel')}</Text>
          </TouchableOpacity>
        )}
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
  // Header row with language toggle
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerSpacer: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    gap: 16,
  },
  content: {
    flex: 1,
    padding: 24,
  },

  section: {
    gap: 8,
  },
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

  // Supplies shortcut link (soft, in-scroll)
  suppliesBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  suppliesBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#A8505A',
    textDecorationLine: 'underline',
  },

  // Expenses shortcut link (soft, in-scroll) — mirrors supplies style
  expensesBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  expensesBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#A8505A',
    textDecorationLine: 'underline',
  },

  // Calendar shortcut link (soft, in-scroll)
  calendarBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  calendarBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#3B8C8C',
    textDecorationLine: 'underline',
  },

  // B-1: KickCount shortcut link (wk≥32 pregnant gate; always visible postpartum)
  kickCountBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  kickCountBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#A8505A',
    textDecorationLine: 'underline',
  },

  // Doctor PDF nav entry button (replaces inline DoctorPdfButton — spec §1)
  doctorPdfBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginVertical: 8,
  },
  doctorPdfBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── Medication Plans shortcut ─────────────────────────────────────────────
  medicationBtn: {
    backgroundColor: '#FBF6F1',
    borderWidth: 1.5,
    borderColor: '#A8505A',
    borderRadius: 10,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginVertical: 8,
  },
  medicationBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#A8505A',
    fontWeight: '700',
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

  settingsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  settingsIcon: {
    fontSize: 22,
    color: '#5F4A52',
  },

  // ── Consent limited-mode nudge banner (§4.3 first-run-consent.md) ───────────
  // Shown at the top of the home scroll when general_health is not granted.
  // Uses rose/600 (#A8505A) to match the consent screen's primary colour.
  consentNudgeBanner: {
    marginHorizontal: 0,
    marginBottom: 12,
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
});
