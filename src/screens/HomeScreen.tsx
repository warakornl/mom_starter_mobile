/**
 * HomeScreen — Dashboard (Calendar Home).
 *
 * Implements calendar-home-ui.md §4 (screen states) and §6.1 (stage banner)
 * for the pregnant lifecycle.
 *
 * Screen states (calendar-home-ui §4):
 *   loading        — skeleton while checking profile
 *   needs-onboarding — 404 from GET /pregnancy-profile → ProfileSetup
 *   populated      — profile found; show gestational-age dashboard
 *   error          — unexpected API error
 *
 * Offline: the stage banner re-derives locally from cached `edd` and the
 * device-local civil date on every foreground event and local midnight.
 * No network is required to display the week counter once the edd is known.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1
 *   surface/page  #FFFFFF
 *   ink           #3A2A30
 *   ink/soft      #5F4A52
 *   ink/faint     #94818A
 *   rose/50       #FBEDEE   (chip bg)
 *   rose/100      #F4D9DC   (delivery chip bg)
 *   rose/600      #A8505A   (primary button)
 *   rose/700      #8E3A44   (delivery chip text)
 *   hairline      #EBE1D9
 *
 * Security: NEVER log the accessToken or any health fields.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  AppState,
  type AppStateStatus,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';
import { createPregnancyClient } from '../pregnancy/pregnancyApiClient';
import {
  computeGestationalAge,
  localCivilToday,
} from '../pregnancy/gestationalAge';
import type { GestationalAge, Stage } from '../pregnancy/gestationalAge';
import type { PregnancyProfile } from '../pregnancy/types';

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
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'populated'; profile: PregnancyProfile; ga: GestationalAge }
  | { kind: 'needs-onboarding' }
  | { kind: 'error'; message: string };

// ─── Stage glyph / label helpers ─────────────────────────────────────────────

const STAGE_GLYPHS: Record<Stage, string> = {
  T1: '🌱', // icon/stage-t1 (seedling)
  T2: '🌿', // icon/stage-t2 (leaf/branch)
  T3: '🌳', // icon/stage-t3 (tree)
};

const STAGE_LABELS: Record<Stage, string> = {
  T1: 'ไตรมาส 1',
  T2: 'ไตรมาส 2',
  T3: 'ไตรมาส 3',
};

// ─── Date formatting ──────────────────────────────────────────────────────────

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatThaiDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]} พ.ศ. ${y + 543}`;
}

// ─── Progress bar (carry-forward: replace with full ring) ─────────────────────
// Uses flex-based fill to avoid percentage-string typing issues with RN 0.74.

function ProgressBar({ progress }: { progress: number }): React.JSX.Element {
  const pct = Math.round(progress * 100);
  // flex-based fill: fill flex = pct, remainder flex = (100 - pct)
  const fillFlex = Math.max(0, pct);
  const remainFlex = 100 - fillFlex;
  return (
    <View
      style={barStyles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={`ความคืบหน้า ${pct}%`}
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
  container: {
    gap: 4,
  },
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#EBE1D9',
  },
  fill: {
    height: 8,
    backgroundColor: '#A8505A',
  },
  remain: {
    height: 8,
    backgroundColor: '#EBE1D9',
  },
  label: {
    fontFamily: 'IBMPlexMono-Medium',
    fontSize: 13,
    color: '#5F4A52',
    textAlign: 'right',
  },
});

// ─── Stage banner ─────────────────────────────────────────────────────────────

function StageBanner({ profile, ga }: { profile: PregnancyProfile; ga: GestationalAge }): React.JSX.Element {
  const stage = ga.currentStage;
  const stageName = STAGE_LABELS[stage];
  const stageGlyph = STAGE_GLYPHS[stage];

  // Week display (§6.1 / OQ-3): "สัปดาห์ที่ N" or "สัปดาห์ที่ N +d วัน"
  const weekLabel = ga.suppressDayDisplay
    ? `สัปดาห์ที่ ${ga.displayedWeek}`
    : ga.gestationalDay > 0
      ? `สัปดาห์ที่ ${ga.displayedWeek} +${ga.gestationalDay} วัน`
      : `สัปดาห์ที่ ${ga.displayedWeek}`;

  // Overdue sub-line (calendar-home-ui §6.1 — forbidden: "เกินกำหนด")
  const isOverdue = ga.daysRemaining < 0;

  const bannerA11yLabel = `${stageName} ${weekLabel}${ga.deliveryWindowActive ? ' เตรียมคลอด' : ''}${isOverdue ? ' ถึงกำหนดแล้ว' : ''}`;

  return (
    <View
      style={bannerStyles.card}
      accessibilityRole="text"
      accessibilityLabel={bannerA11yLabel}
    >
      {/* Stage glyph in tint disc */}
      <View style={bannerStyles.glyphDisc} accessibilityElementsHidden={true}>
        <Text style={bannerStyles.glyph}>{stageGlyph}</Text>
      </View>

      <View style={bannerStyles.textCol}>
        {/* Stage + week (headline) */}
        <View style={bannerStyles.stageLine} accessibilityElementsHidden={true}>
          <Text style={bannerStyles.stageLabel}>{stageName}</Text>
          <Text style={bannerStyles.dot}>{' · '}</Text>
          <Text style={bannerStyles.weekLabel}>{weekLabel}</Text>

          {/* Delivery-window chip — non-interactive, overlay only (§6.1 / AC-27/28) */}
          {ga.deliveryWindowActive && (
            <View
              style={bannerStyles.deliveryChip}
              accessibilityRole="text"
              accessibilityLabel="เตรียมคลอด"
            >
              <Text style={bannerStyles.deliveryChipText}>{'เตรียมคลอด'}</Text>
            </View>
          )}
        </View>

        {/* Overdue sub-line (daysRemaining < 0, no birth event) */}
        {isOverdue && (
          <Text style={bannerStyles.overdueLine} accessibilityElementsHidden={true}>
            {'ถึงกำหนดแล้ว · บันทึกการคลอดเมื่อพร้อม'}
          </Text>
        )}

        {/* Days remaining / EDD (when not overdue) */}
        {!isOverdue && (
          <Text style={bannerStyles.eddLine} accessibilityElementsHidden={true}>
            {`กำหนดคลอด ${formatThaiDate(profile.edd)} (อีก ${ga.daysRemaining} วัน)`}
          </Text>
        )}
      </View>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
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
});

// ─── Skeleton (loading) ────────────────────────────────────────────────────────

function Skeleton(): React.JSX.Element {
  return (
    <View style={skelStyles.container} accessibilityLabel="กำลังโหลด">
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
}: HomeScreenProps): React.JSX.Element {
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const loadedEdd = useRef<string | null>(null);

  // ── Recompute gestational age from cached edd (pure civil-date, no network) ─
  const recomputeFromEdd = useCallback((edd: string): GestationalAge => {
    return computeGestationalAge(edd, localCivilToday());
  }, []);

  // ── Load profile from server ───────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken;
    if (!accessToken) {
      // Token gone — navigate to auth
      onLogout();
      return;
    }

    const client = createPregnancyClient(apiBaseUrl);
    const result = await client.getProfile(accessToken, localCivilToday());

    if (result.ok) {
      loadedEdd.current = result.profile.edd;
      const ga = recomputeFromEdd(result.profile.edd);
      setState({ kind: 'populated', profile: result.profile, ga });
    } else if (result.status === 404) {
      setState({ kind: 'needs-onboarding' });
    } else {
      setState({ kind: 'error', message: result.message });
    }
  }, [tokenStorage, apiBaseUrl, onLogout, recomputeFromEdd]);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // ── Navigate to ProfileSetup when no profile found ─────────────────────────
  useEffect(() => {
    if (state.kind === 'needs-onboarding') {
      onNeedsProfile();
    }
  }, [state.kind, onNeedsProfile]);

  // ── Recompute on foreground / midnight (civil-date rollover) ─────────────────
  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next === 'active' && loadedEdd.current) {
        const ga = recomputeFromEdd(loadedEdd.current);
        setState((prev) =>
          prev.kind === 'populated'
            ? { ...prev, ga }
            : prev,
        );
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [recomputeFromEdd]);

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function handleLogout(): Promise<void> {
    try {
      await tokenStorage.clear();
    } catch {
      // Storage clear failure is non-fatal
    }
    onLogout();
  }

  function confirmLogout(): void {
    Alert.alert(
      'ออกจากระบบ',
      'คุณต้องการออกจากระบบใช่ไหม?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ออกจากระบบ', style: 'destructive', onPress: () => void handleLogout() },
      ],
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorHeadline}>{'เปิดข้อมูลในเครื่องไม่สำเร็จ'}</Text>
          <Text style={styles.errorSubline}>{'ข้อมูลของคุณยังอยู่ในเครื่อง'}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => void loadProfile()}
            accessibilityRole="button"
            accessibilityLabel="ลองอีกครั้ง"
          >
            <Text style={styles.retryBtnText}>{'ลองอีกครั้ง'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // needs-onboarding state is handled via the useEffect above (navigate immediately)
  // Render a loading skeleton while the navigation event processes.
  if (state.kind === 'needs-onboarding') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </SafeAreaView>
    );
  }

  // ── Populated state ───────────────────────────────────────────────────────

  const { profile, ga } = state;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Stage banner (§6.1 / calendar-home-ui §6) */}
        <StageBanner profile={profile} ga={ga} />

        {/* Progress bar */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{'ความคืบหน้าการตั้งครรภ์'}</Text>
          <ProgressBar progress={ga.progress} />
        </View>

        {/* Days remaining / overdue */}
        <View style={styles.daysCard}>
          {ga.daysRemaining >= 0 ? (
            <>
              <Text style={styles.daysNumber}>{ga.daysRemaining}</Text>
              <Text style={styles.daysLabel}>{'วันก่อนถึงกำหนดคลอด'}</Text>
            </>
          ) : (
            <>
              {/* Overdue: neutral copy — forbidden: "เกินกำหนด" (calendar-home-ui §6.1) */}
              <Text style={styles.overdueLabel}>
                {'ถึงกำหนดแล้ว · บันทึกการคลอดเมื่อพร้อม'}
              </Text>
            </>
          )}
        </View>

        {/* Placeholder areas for calendar grid + suggestions (next slices) */}
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            {'ปฏิทินและบันทึกรายวัน — Slice ถัดไป'}
          </Text>
        </View>
      </ScrollView>

      {/* Logout */}
      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={confirmLogout}
        accessibilityRole="button"
        accessibilityLabel="ออกจากระบบ"
      >
        <Text style={styles.logoutBtnText}>{'ออกจากระบบ'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
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

  // Section
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52',
  },

  // Days card
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

  // Placeholder
  placeholderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 24,
    alignItems: 'center',
  },
  placeholderText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#94818A',
  },

  // Error
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

  // Logout
  logoutBtn: {
    height: 52,
    marginHorizontal: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#5F4A52',
  },
});
