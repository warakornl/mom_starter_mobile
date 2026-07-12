/**
 * HomeTabScreen — Home tab (Mother's Room flagship re-skin; §4.1).
 *
 * v3 mother-room (mother-room-build-spec.md §4.1, §4.2, §4.3).
 * Re-skinned in place — all business logic, navigation callbacks, and
 * screen-state transitions are UNCHANGED from v2.
 *
 * Responsibilities (unchanged):
 *   1. Profile GET + lifecycle branching.
 *   2. Updates PregnancyProfileContext via useProfileSnapshotSetter().
 *   3. Renders Mother's Room layout per §4.1:
 *        Greeting bar → week hero → JasmineDivider → baby subtitle
 *        → progress line → [hairline] → AccentRow data rows → amber CTA.
 *   4. Screen states (§4.1 state matrix): loading, empty, error, offline,
 *        populated, loss (lifecycle='ended'), needs-onboarding.
 *
 * Key Mother's Room visual changes from v2 (§1.8 / §4.1):
 *   - Week hero: flat (no card border), 32sp Sarabun-SemiBold roselle-900.
 *   - JasmineDivider between week hero text and baby-size subtitle.
 *   - Progress: 4dp amber-600 fill on ivory-200 track.
 *   - Data rows: AccentRow (3dp left accent bar).
 *   - CTA: ONE amber card (amber-700, 52dp, elev/1).
 *   - Loss state (lifecycle='ended'): week hero hidden; date in heading1 style;
 *       kick-count row hidden.
 *   - Fonts: Sarabun-SemiBold / Sarabun-Regular throughout (no IBMPlexSans).
 *   - Colors: all via T.color.* (no inline hex).
 *
 * Constraint (§6B): MUST NOT embed VirtualizedList, FlatList, or CalendarScreen.
 *
 * Navigation callbacks:
 *   onLogout             → performLogout + reset to Welcome
 *   onNeedsProfile       → reset to ProfileSetup (GET 404)
 *   onBirthEvent(v)      → navigate to BirthEvent (T3 only)
 *   onSuggestions        → navigate to Suggestions
 *   onKickCount          → navigate to KickCountHome (pregnant wk≥32 kick row tap)
 *   onSupplies           → switch to Supplies tab
 *   onCalendar           → switch to Calendar tab
 *   onDoctorReport       → navigate to DoctorReport
 *   onCapture            → navigate to CaptureScreen (amber CTA tap)
 *   WeeklyMilestoneSheet → managed internally (week-zone tap → internal state; §4.2)
 *
 * Security: never log accessToken or health field values (SD-9).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
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
import { runHomeTabProfileVerbDrain } from './homeTabProfileVerbDrain';
import { buildCalendarTabSnapshot } from './calendarTabSnapshotBuilder';
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
import { AccentRow } from '../home/AccentRow';
import { JasmineDivider } from '../illustrations/JasmineDivider';
import { WeeklyMilestoneSheet } from './WeeklyMilestoneSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HomeTabScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  /** Route through performLogout + reset to Welcome on session expiry. */
  onLogout: () => void;
  /** Reset to ProfileSetup (GET 404). Tab bar suppressed. */
  onNeedsProfile: () => void;
  /** Navigate to BirthEvent (T3 only). Passes current profile version for If-Match header. */
  onBirthEvent: (profileVersion: number) => void;
  /** Navigate to SuggestionFlowScreen. */
  onSuggestions?: () => void;
  /** Navigate to KickCountHomeScreen (pregnant wk≥32 kick-count row tapped). */
  onKickCount?: () => void;
  /** Switch to the Supplies tab (suggestion CTA). */
  onSupplies?: () => void;
  /** Switch to the Calendar tab (suggestion CTA). */
  onCalendar?: () => void;
  /**
   * Navigate to DoctorReport root-stack screen.
   * Spec §3.3: only called when snapshot !== null.
   */
  onDoctorReport: () => void;
  /**
   * Navigate to CaptureScreen (amber CTA tap / loss-state CTA).
   * §4.1: amber CTA → CaptureScreen.
   */
  onCapture?: () => void;
  /**
   * Navigate to FeedingLogScreen (Bug #4 — entry moved here from Supplies tab).
   * Shown in non-loss states only (pregnant !isLoss, and postpartum).
   * SD-9: no health data in this prop — it is a navigation callback only.
   * FW-1: row label is a neutral Thai verb ("บันทึกการให้นม") only.
   */
  onFeedingLog?: () => void;
  // WeeklyMilestoneSheet is managed internally — week-zone tap opens it via local state (§4.2).
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'pregnant'; profile: PregnancyProfile; ga: GestationalAge }
  | { kind: 'postpartum'; profile: PregnancyProfile; pp: PostpartumAge }
  | { kind: 'needs-onboarding' }
  | { kind: 'error'; message: string };

// ─── Stage icon helpers ───────────────────────────────────────────────────────

const STAGE_ICONS: Record<Stage, React.FC<{ color: string; size: number }>> = {
  T1: StageT1Icon,
  T2: StageT2Icon,
  T3: StageT3Icon,
};

// ─── Mother's Room Progress Bar (§4.1: amber-600 fill, 4dp) ─────────────────

function ProgressLine({ progress }: { progress: number }): React.JSX.Element {
  const { t } = useT();
  const pct = Math.round(Math.max(0, Math.min(100, progress * 100)));
  return (
    <View
      style={progressStyles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={t('home.progressA11y', { pct })}
    >
      <View style={progressStyles.track}>
        {/* Filled segment — amber-600 */}
        <View style={[progressStyles.fill, { flex: pct }]} />
        {/* Remaining segment — ivory-200 track */}
        {100 - pct > 0 && (
          <View style={[progressStyles.remain, { flex: 100 - pct }]} />
        )}
      </View>
      <Text style={progressStyles.label}>{`${pct}%`}</Text>
    </View>
  );
}

const progressStyles = StyleSheet.create({
  container: { gap: T.spacing[1] },
  track: {
    flexDirection: 'row',
    height: T.progress.height,              // 4dp — §4.1
    borderRadius: T.radius.pill,
    overflow: 'hidden',
    backgroundColor: T.progress.track.color, // #E8DDD5 divider
  },
  fill: {
    height: T.progress.height,
    backgroundColor: T.progress.fill.color, // amber-600 #B8720E
  },
  remain: {
    height: T.progress.height,
    backgroundColor: T.progress.track.color,
  },
  label: {
    fontFamily: T.type.caption.fontFamily,  // Sarabun-Regular
    fontSize: T.type.caption.size,          // 13sp
    lineHeight: T.type.caption.lineHeight,  // 21sp
    color: T.color.text.botanical,          // jade-800 #2F5042 — AAA at any size (R4 §0)
    textAlign: 'right',
  },
});

// ─── Week Hero Zone (§4.1 flat, no card) ──────────────────────────────────────
//
// §4.2: The entire zone is a single tappable area → opens WeeklyMilestoneSheet.
// Touch target ≥56dp (enforced via minHeight on Pressable).

function WeekHeroZone({
  profile,
  ga,
  isLoss,
  onPress,
}: {
  profile: PregnancyProfile;
  ga?: GestationalAge;
  isLoss: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  const { t, locale } = useT();

  // §4.1 Loss state: date replaces week counter (heading1: 24sp Sarabun-SemiBold)
  const lossDate = profile.edd
    ? formatCivilDate(profile.edd, locale)
    : formatCivilDate(localCivilToday(), locale);

  const weekLabel = ga
    ? ga.suppressDayDisplay
      ? t('home.weekDisplay', { n: ga.displayedWeek })
      : ga.gestationalDay > 0
        ? t('home.weekDisplayDays', { n: ga.displayedWeek, d: ga.gestationalDay })
        : t('home.weekDisplay', { n: ga.displayedWeek })
    : '';

  // §4.1: Baby-size subtitle — shown at 15sp jade-600 (meets R4: exactly 15sp).
  // The BabySizeSection renders its own subtitle; we show a flat text line here.
  const a11yLabel = isLoss ? lossDate : weekLabel;

  return (
    <Pressable
      testID="home-week-hero"
      style={weekHeroStyles.zone}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a11yLabel} ${t('home.tapForMilestone')}`}
      // §4.2: minimum 56dp height for the tappable zone
    >
      {/* §4.1 Loss state: show date in heading1 style; hide week counter */}
      {isLoss ? (
        <Text
          style={weekHeroStyles.lossDateText}
          accessibilityRole="text"
        >
          {lossDate}
        </Text>
      ) : (
        <Text
          style={weekHeroStyles.weekText}
          accessibilityRole="text"
          accessibilityLabel={weekLabel}
        >
          {weekLabel}
        </Text>
      )}

      {/* §4.1: JasmineDivider between week hero text and baby-size subtitle */}
      {/* §3.1: decorative — hidden from a11y tree */}
      <JasmineDivider color={T.color.accent.botanical} />
    </Pressable>
  );
}

const weekHeroStyles = StyleSheet.create({
  zone: {
    minHeight: 56,                        // §4.2: minimum tappable zone height
    paddingHorizontal: T.spacing[0],      // flush with scroll content
    paddingTop: T.spacing[2],             // 8dp top breathing room
    paddingBottom: T.spacing[2],          // 8dp below divider before subtitle
    gap: T.spacing[2],                    // 8dp between week text and jasmine divider
  },
  weekText: {
    fontFamily: T.type.display.fontFamily,  // Sarabun-SemiBold
    fontSize: T.type.display.size,          // 32sp
    lineHeight: T.type.display.lineHeight,  // 52sp — §0 R2 ≥1.6× Thai rule
    color: T.color.text.heading,            // roselle-900 #4A2230
  },
  lossDateText: {
    // §4.1 Loss state: "10 กรกฎาคม 2569" Sarabun/600 24sp (type.heading1)
    fontFamily: T.type.heading1.fontFamily, // Sarabun-SemiBold
    fontSize: T.type.heading1.size,         // 24sp
    lineHeight: T.type.heading1.lineHeight, // 39sp — §0 R2 ≥1.6× Thai rule
    color: T.color.text.heading,            // roselle-900 #4A2230
  },
});

// ─── Greeting bar (§4.1 flat, not a card) ─────────────────────────────────────
// Sarabun/400 15sp roselle-700; no background card.

function GreetingBar(): React.JSX.Element {
  const { t } = useT();
  return (
    <View style={greetingStyles.bar}>
      <Text
        style={greetingStyles.text}
        accessibilityRole="text"
      >
        {t('home.greeting')}
      </Text>
    </View>
  );
}

const greetingStyles = StyleSheet.create({
  bar: {
    paddingVertical: T.spacing[1],    // 4dp
  },
  text: {
    fontFamily: T.type.body.fontFamily,   // Sarabun-Regular
    fontSize: T.type.body.size,           // 15sp
    lineHeight: T.type.body.lineHeight,   // 25sp
    color: T.color.text.primary,          // roselle-700 #7A3A52 (7.70:1 AAA)
  },
});

// ─── StageBanner (stage label + week, for non-loss pregnant mode) ─────────────
// Now minimal — the week hero zone handles the big display number.
// StageBanner shows just the stage name + T3 birth CTA.

function StageBadge({
  profile,
  ga,
  onBirthEvent,
}: {
  profile: PregnancyProfile;
  ga: GestationalAge;
  onBirthEvent: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const stage = ga.currentStage;
  const stageName = t(`stage.${stage}` as 'stage.T1' | 'stage.T2' | 'stage.T3');
  const StageIcon = STAGE_ICONS[stage];
  const isT3 = stage === 'T3';

  return (
    <View style={stageBadgeStyles.row} accessibilityElementsHidden={true}>
      <StageIcon color={T.color.accent.identity} size={20} />
      <Text style={stageBadgeStyles.label}>{stageName}</Text>
      {isT3 && (
        <TouchableOpacity
          testID="home-birth-cta"
          style={stageBadgeStyles.birthCta}
          onPress={onBirthEvent}
          accessibilityRole="button"
          accessibilityLabel={t('home.birthCtaA11y')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={stageBadgeStyles.birthCtaText}>{t('home.birthCta')}</Text>
        </TouchableOpacity>
      )}
      {/* Suppress accessibilityElementsHidden on children so birthCta is reachable */}
    </View>
  );
}

const stageBadgeStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.spacing[2],
    flexWrap: 'wrap',
  },
  label: {
    fontFamily: T.type.label.fontFamily,    // Sarabun-SemiBold
    fontSize: T.type.label.size,            // 15sp
    lineHeight: T.type.label.lineHeight,    // 24sp
    color: T.color.text.primary,            // roselle-900 #4A2230
  },
  birthCta: {
    marginLeft: T.spacing[1],
    paddingVertical: T.spacing[1],          // 4dp vertical padding for tap target
    minHeight: 32,
    justifyContent: 'center',
  },
  birthCtaText: {
    fontFamily: T.type.label.fontFamily,    // Sarabun-SemiBold
    fontSize: T.type.label.size,            // 15sp
    color: T.color.accent.interactive,      // amber-700 #9A5F0A — sole interactive accent
    textDecorationLine: 'underline',
  },
});

// ─── Postpartum banner (unchanged except font + color tokens) ────────────────

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
      <PostpartumStageIcon color={T.color.accent.botanical} size={28} />
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
    backgroundColor: T.color.surface.subtle, // ivory-200 #F5EDE6 (warm, not green)
    borderRadius: T.radius.md,               // 12dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,    // #E8DDD5
    padding: T.spacing[4],                   // 16dp
    gap: T.spacing[3],                       // 12dp
  },
  textCol: { flex: 1, gap: T.spacing[1] },
  stageLabel: {
    fontFamily: T.type.label.fontFamily,     // Sarabun-SemiBold
    fontSize: T.type.label.size,             // 15sp
    lineHeight: T.type.label.lineHeight,     // 24sp
    color: T.color.text.botanical,           // jade-800 #2F5042
  },
  ageLabel: {
    fontFamily: T.type.heading2.fontFamily,  // Sarabun-SemiBold
    fontSize: T.type.heading2.size,          // 20sp
    lineHeight: T.type.heading2.lineHeight,  // 33sp
    color: T.color.text.heading,             // roselle-900 #4A2230
  },
  birthdateLine: {
    fontFamily: T.type.caption.fontFamily,   // Sarabun-Regular
    fontSize: T.type.caption.size,           // 13sp
    lineHeight: T.type.caption.lineHeight,   // 21sp
    color: T.color.text.botanical,           // jade-800 #2F5042 (safe AAA at 13sp)
  },
});

// ─── Postpartum day card ───────────────────────────────────────────────────────

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
    backgroundColor: T.color.surface.base,  // ivory-100 #FBF6F1
    borderRadius: T.radius.md,              // 12dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,   // #E8DDD5
    padding: T.spacing[6],                  // 24dp
    alignItems: 'flex-start',
  },
  number: {
    fontFamily: T.type.display.fontFamily,  // Sarabun-SemiBold
    fontSize: T.type.display.size,          // 32sp
    lineHeight: T.type.display.lineHeight,  // 52sp
    color: T.color.accent.botanical,        // jade-800 #2F5042
  },
  label: {
    fontFamily: T.type.body.fontFamily,     // Sarabun-Regular
    fontSize: T.type.body.size,             // 15sp
    lineHeight: T.type.body.lineHeight,     // 25sp
    color: T.color.text.secondary,          // jade-600 #4A7A5C — ≥15sp ✓ (R4)
  },
});

// ─── Loading skeleton (§4.1 state 1) ─────────────────────────────────────────

function Skeleton(): React.JSX.Element {
  const { t } = useT();
  return (
    <View style={skelStyles.container} accessibilityLabel={t('home.loading')}>
      {/* Week-hero bone: 32sp × 52LH */}
      <View style={skelStyles.heroBone} />
      {/* Jasmine divider bone: thin horizontal line */}
      <View style={skelStyles.dividerBone} />
      {/* Data row bones (56dp each) */}
      <View style={[skelStyles.bone, { height: 56 }]} />
      <View style={[skelStyles.bone, { height: 56 }]} />
      {/* CTA button bone: 52dp */}
      <View style={[skelStyles.bone, { height: T.button.primary.height, borderRadius: T.radius.md }]} />
    </View>
  );
}

const skelStyles = StyleSheet.create({
  container: { gap: T.spacing[3] },   // 12dp
  heroBone: {
    height: T.type.display.lineHeight,  // 52dp (matches week hero line-height)
    borderRadius: T.radius.sm,          // 6dp
    backgroundColor: T.skeleton.color,  // ivory-200 #F5EDE6
    width: '60%',
  },
  dividerBone: {
    height: 1,
    backgroundColor: T.skeleton.color,
    width: '100%',
  },
  bone: {
    height: 24,
    borderRadius: T.radius.sm,
    backgroundColor: T.skeleton.color,
    width: '100%',
  },
});

// ─── Amber CTA Card (§4.1 ONE per screen; sole interactive accent) ────────────

function AmberCtaCard({
  label,
  onPress,
}: {
  label: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      testID="home-amber-cta"
      style={ctaStyles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={ctaStyles.label}>{label}</Text>
      <Text style={ctaStyles.arrow} accessibilityElementsHidden={true}>{'→'}</Text>
    </TouchableOpacity>
  );
}

const ctaStyles = StyleSheet.create({
  card: {
    backgroundColor: T.button.primary.bg,       // amber-700 #9A5F0A
    borderRadius: T.button.primary.radius,       // 12dp (radius.md)
    height: T.button.primary.height,             // 52dp
    paddingHorizontal: T.spacing[4],             // 16dp
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // §1.3 elev/1: warm shadow
    shadowColor: T.elev[1].shadowColor,
    shadowOffset: T.elev[1].shadowOffset,
    shadowOpacity: T.elev[1].shadowOpacity,
    shadowRadius: T.elev[1].shadowRadius,
    elevation: T.elev[1].elevation,
  },
  label: {
    fontFamily: T.type.label.fontFamily,   // Sarabun-SemiBold
    fontSize: T.type.label.size,           // 15sp
    lineHeight: T.type.label.lineHeight,   // 24sp
    color: T.button.primary.text,          // #FFFFFF
  },
  arrow: {
    fontFamily: T.type.label.fontFamily,
    fontSize: T.type.label.size,
    color: T.button.primary.text,
  },
});

// ─── Error panel (§4.1 state 3) ───────────────────────────────────────────────

function ErrorPanel({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useT();
  return (
    <View style={errorStyles.panel}>
      <Text style={errorStyles.headline}>{t('home.errorHeadline')}</Text>
      <Text style={errorStyles.body}>{t('home.errorSubline')}</Text>
      <TouchableOpacity
        style={errorStyles.retryBtn}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t('general.retry')}
      >
        <Text style={errorStyles.retryBtnText}>{t('general.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  panel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: T.spacing[8],      // 32dp
    gap: T.spacing[4],          // 16dp
    backgroundColor: T.errorPanel.bg, // ivory-100 #FBF6F1
  },
  headline: {
    fontFamily: T.type.heading2.fontFamily, // Sarabun-SemiBold
    fontSize: T.type.heading2.size,         // 20sp
    lineHeight: T.type.heading2.lineHeight, // 33sp
    color: T.errorPanel.headline,           // roselle-900 #4A2230
    textAlign: 'center',
  },
  body: {
    fontFamily: T.type.body.fontFamily,     // Sarabun-Regular
    fontSize: T.type.body.size,             // 15sp — §0 R4: jade-600 ≥15sp ✓
    lineHeight: T.type.body.lineHeight,     // 25sp
    color: T.errorPanel.body,               // jade-600 #4A7A5C (at 15sp — R4 ✓)
    textAlign: 'center',
  },
  retryBtn: {
    height: T.button.primary.height,        // 52dp
    paddingHorizontal: T.spacing[8],        // 32dp
    backgroundColor: T.button.primary.bg,   // amber-700 #9A5F0A
    borderRadius: T.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontFamily: T.type.label.fontFamily,    // Sarabun-SemiBold
    fontSize: T.type.label.size,            // 15sp
    lineHeight: T.type.label.lineHeight,    // 24sp
    color: T.button.primary.text,           // #FFFFFF
  },
});

// ─── Hairline divider ─────────────────────────────────────────────────────────

function Hairline(): React.JSX.Element {
  return (
    <View
      style={hairlineStyles.line}
      accessibilityElementsHidden={true}
      // @ts-ignore
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const hairlineStyles = StyleSheet.create({
  line: {
    height: 1,
    backgroundColor: T.color.surface.divider, // #E8DDD5
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
  onSupplies,
  onCalendar,
  onDoctorReport,
  onCapture,
  onFeedingLog,
}: HomeTabScreenProps): React.JSX.Element {
  const { t } = useT();
  const setSnapshot = useProfileSnapshotSetter();

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [suggestionTick, setSuggestionTick] = useState(0);
  // §4.2: WeeklyMilestoneSheet visibility — lifted here so isLoss can be threaded in.
  const [milestoneSheetVisible, setMilestoneSheetVisible] = useState(false);

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
    const accessToken = tokens?.accessToken ?? null;

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
        void ga;
      },
      onPostpartum: (profile, pp) => {
        loadedBirthDate.current = profile.birthDate ?? null;
        loadedEdd.current = null;
        const freshPp = recomputeFromBirthDate(profile.birthDate!);
        setState({ kind: 'postpartum', profile, pp: freshPp });
        void pp;
      },
      onError: (message) => setState({ kind: 'error', message }),
    });
  }, [tokenStorage, apiBaseUrl, onLogout, recomputeFromEdd, recomputeFromBirthDate, setSnapshot]);

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
      void drainConsentQueue(tokenStorage, apiBaseUrl);

      // profileVerbQueue drain host (OR-STRUCT-1): same AppState 'active'
      // handler as drainConsentQueue, per
      // docs/architecture/direct-rest-offline-resilience-architecture.md §1.3.
      // Only attempt a drain once a profile is actually loaded (we need its
      // version to seed resolveIfMatch on the first drain this session).
      const currentVersion =
        state.kind === 'pregnant' || state.kind === 'postpartum'
          ? state.profile.version
          : null;
      if (currentVersion !== null) {
        void runHomeTabProfileVerbDrain({
          tokenStorage,
          apiBaseUrl,
          liveProfileVersion: currentVersion,
          onAdopt: (profile) => {
            // §9: adopt the server-confirmed profile — settle the pending-sync
            // state. Raw lifecycle wiring (GAP-2-safe): no `?? 'pregnant'`.
            const todayCivil = localCivilToday();
            if (profile.lifecycle === 'postpartum' && profile.birthDate) {
              const pp = recomputeFromBirthDate(profile.birthDate);
              loadedBirthDate.current = profile.birthDate;
              loadedEdd.current = null;
              setState({ kind: 'postpartum', profile, pp });
              setSnapshot(
                buildCalendarTabSnapshot({
                  profile, ga: null,
                  generalHealthConsented: consentStore.isGranted('general_health'),
                  todayCivil,
                }),
              );
            } else {
              const ga = recomputeFromEdd(profile.edd);
              loadedEdd.current = profile.edd;
              loadedBirthDate.current = null;
              setState({ kind: 'pregnant', profile, ga });
              setSnapshot(
                buildCalendarTabSnapshot({
                  profile, ga,
                  generalHealthConsented: consentStore.isGranted('general_health'),
                  todayCivil,
                }),
              );
            }
          },
        });
      }

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
  }, [recomputeFromEdd, recomputeFromBirthDate, tokenStorage, apiBaseUrl, state, setSnapshot]);

  // ─── Loading (§4.1 state 1) ───────────────────────────────────────────────

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error (§4.1 state 3) ─────────────────────────────────────────────────

  if (state.kind === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorPanel onRetry={() => void loadProfile()} />
      </SafeAreaView>
    );
  }

  // ─── Needs-onboarding (§4.1 state 7) — reset via useEffect above ─────────

  if (state.kind === 'needs-onboarding') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Derived consent + suggestion state ───────────────────────────────────

  const generalHealthGranted = consentStore.isGranted('general_health');
  void suggestionTick;

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
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <GreetingBar />
          <Hairline />
          <PostpartumBanner profile={profile} pp={pp} />
          {sections.showPostpartumDayCard && <PostpartumDayCard pp={pp} />}
          <BabySizeSection variant="postpartum" pp={pp} />
          {sections.showSuggestionBanner && ppTopSuggestion && (
            <SuggestionBanner
              topSuggestion={ppTopSuggestion}
              onAction={handleResolveSuggestionAction(ppTopSuggestion.captureTarget)}
              onDismiss={() => handleSuggestionDismiss(ppTopSuggestion.key)}
              onViewAll={onSuggestions}
            />
          )}
          {/* §4.1: Amber CTA — sole interactive accent */}
          <AmberCtaCard
            label={t('home.captureToday')}
            onPress={onCapture}
          />

          {/*
           * Bug #4: feeding-log entry — postpartum is a non-loss state, always shown here.
           * Inlined (not a helper sub-component) so plain-function-call unit tests can
           * traverse the full element tree without a renderer (same convention as the
           * Doctor Report row above / AutoDecrementSettingsScreen's all-inline body).
           */}
          <TouchableOpacity
            testID="home-feeding-log-row"
            style={styles.doctorReportRow}
            onPress={onFeedingLog}
            accessibilityRole="button"
            accessibilityLabel={t('home.feedingLog')}
          >
            <Text style={styles.doctorReportLabel}>{t('home.feedingLog')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Pregnant mode ────────────────────────────────────────────────────────

  const { profile, ga } = state;

  // §4.1 Loss state: lifecycle='ended' → week hero hidden; kick-count hidden.
  const isLoss = profile.lifecycle === 'ended';

  const pregnantOfferables: OfferableSuggestion[] = getOfferable(
    {
      lifecycle: isLoss ? 'ended' : 'pregnant',
      stage: isLoss ? null : ga.currentStage,
      gestationalWeek: isLoss ? 0 : ga.gestationalWeek,
      now: new Date(),
    },
    suggestionStore.getState(),
  );
  const pregnantTopSuggestion = pregnantOfferables[0] ?? null;

  const sections = resolveCalendarDashboardSections({
    lifecycle: isLoss ? 'ended' : 'pregnant',
    gestationalWeek: isLoss ? 0 : ga.gestationalWeek,
    generalHealthGranted,
    hasOfferableSuggestion: pregnantTopSuggestion !== null,
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* §4.1: Greeting bar (flat, not a card) */}
        <GreetingBar />
        <Hairline />

        {/* §4.1: Stage badge (minimized — week hero now carries the number) */}
        {!isLoss && sections.showStageBanner && (
          <StageBadge
            profile={profile}
            ga={ga}
            onBirthEvent={() => onBirthEvent(profile.version)}
          />
        )}

        {/*
          §4.1 + §4.2: Week hero zone — tappable → opens WeeklyMilestoneSheet.
          Contains week text + JasmineDivider + (baby subtitle after zone).
          Loss state: shows date instead of week.
        */}
        <WeekHeroZone
          profile={profile}
          ga={isLoss ? undefined : ga}
          isLoss={isLoss}
          onPress={() => setMilestoneSheetVisible(true)}
        />

        {/* §4.1: Baby-size subtitle at 15sp jade-600 (R4: ≥15sp ✓) */}
        {!isLoss && ga.gestationalWeek >= 5 && (
          <BabySizeSection variant="pregnant" ga={ga} />
        )}

        {/* §4.1: Progress line (amber-600 fill, 4dp track) */}
        {!isLoss && sections.showProgressBar && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('home.pregnancyProgress')}</Text>
            <ProgressLine progress={ga.progress} />
          </View>
        )}

        <Hairline />

        {/* §4.1: Data list rows — AccentRow (3dp left accent bar) */}
        {/* Kick-count (pregnancy row: roselle-500 bar); hidden in loss state */}
        {!isLoss && sections.showKickCountCard && (
          <AccentRow
            type="pregnancy"
            title={t('kick.countCard')}
            value={t('home.kickCountToday')}
            onPress={onKickCount}
            accessibilityLabel={t('kick.countCard')}
          />
        )}

        {/* §4.1: Suggestion banner (consented + offerable) */}
        {sections.showSuggestionBanner && pregnantTopSuggestion && (
          <SuggestionBanner
            topSuggestion={pregnantTopSuggestion}
            onAction={handleResolveSuggestionAction(pregnantTopSuggestion.captureTarget)}
            onDismiss={() => handleSuggestionDismiss(pregnantTopSuggestion.key)}
            onViewAll={onSuggestions}
          />
        )}

        {/* §4.1: Amber CTA card (ONE per screen; sole interactive accent amber-700) */}
        {/* §4.1 Loss state: CTA text changes to "บันทึกความรู้สึกวันนี้" */}
        <AmberCtaCard
          label={isLoss ? t('home.captureFeeling') : t('home.captureToday')}
          onPress={onCapture}
        />

        {/* Doctor Report entry row (§3.3: always visible — below amber CTA) */}
        <TouchableOpacity
          testID="home-tab-doctor-report-row"
          style={styles.doctorReportRow}
          onPress={onDoctorReport}
          accessibilityRole="button"
          accessibilityLabel={t('pdf.screen.builderTitle')}
        >
          <Text style={styles.doctorReportLabel}>{t('home.doctorReport')}</Text>
        </TouchableOpacity>

        {/*
         * Bug #4: feeding-log entry — non-loss pregnant state only (loss-gate discipline).
         * Inlined (not a helper sub-component) — see postpartum branch comment above.
         */}
        {!isLoss && (
          <TouchableOpacity
            testID="home-feeding-log-row"
            style={styles.doctorReportRow}
            onPress={onFeedingLog}
            accessibilityRole="button"
            accessibilityLabel={t('home.feedingLog')}
          >
            <Text style={styles.doctorReportLabel}>{t('home.feedingLog')}</Text>
          </TouchableOpacity>
        )}

      </ScrollView>

      {/* §4.2: WeeklyMilestoneSheet — Modal owned here so isLoss can be threaded in.
          Week-zone tap (onPress above) → setMilestoneSheetVisible(true).
          CTA → onCapture (navigates to CaptureScreen). */}
      <WeeklyMilestoneSheet
        visible={milestoneSheetVisible}
        onClose={() => setMilestoneSheetVisible(false)}
        onNavigateToCapture={() => {
          setMilestoneSheetVisible(false);
          onCapture?.();
        }}
        isLoss={isLoss}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,  // ivory-100 #FBF6F1
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: T.spacing[4],   // 16dp
    paddingVertical: T.spacing[6],     // 24dp top + bottom
    gap: T.spacing[4],                 // 16dp between sections
  },
  content: {
    flex: 1,
    padding: T.spacing[6],             // 24dp
  },

  section: { gap: T.spacing[2] },     // 8dp label-to-content

  sectionLabel: {
    fontFamily: T.sectionLabelFontFamily,         // Sarabun-SemiBold
    fontSize: T.sectionLabelFontSize,             // 15sp
    lineHeight: T.type.label.lineHeight,          // 24sp
    letterSpacing: T.sectionLabelLetterSpacing,   // 0 (Thai no tracking)
    color: T.sectionLabelColor,                   // jade-800 #2F5042
  },

  // Doctor Report row — secondary action row (below amber CTA)
  doctorReportRow: {
    backgroundColor: T.color.surface.base,        // #FFFFFF
    borderRadius: T.radius.md,                    // 12dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,         // #E8DDD5
    minHeight: T.button.primary.height,           // 52dp — reuse CTA height for consistency
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingVertical: T.spacing[3],                // 12dp
    justifyContent: 'center',
  },
  doctorReportLabel: {
    fontFamily: T.type.label.fontFamily,          // Sarabun-SemiBold
    fontSize: T.type.label.size,                  // 15sp
    lineHeight: T.type.label.lineHeight,          // 24sp
    color: T.color.accent.interactive,            // amber-700 #9A5F0A — sole interactive accent
  },
});
