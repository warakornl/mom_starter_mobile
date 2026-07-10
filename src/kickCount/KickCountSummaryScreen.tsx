/**
 * SC-K3: KickCountSummaryScreen — post-finalize session summary.
 *
 * K-5b invariants (testable):
 *   - icon/book (not done stamp ◉ / no sage/700 color)
 *   - No celebratory copy ("เก่งมาก!", "ครบแล้ว!")
 *   - count=3 and count=10 produce identical UI — only the number differs
 *   - All values displayed with heading color — no status/conditional coloring
 *
 * INV-K6: safety strip + disclaimer always-on.
 * INV-K1: no derived verdict/clinical string from the count value.
 *
 * Data source: reads from kickCountSyncStore (the just-finalized local row).
 *
 * Security: never log movementCount or any session field (K-8 MOTHER-health).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { kickCountSyncStore } from './kickCountSyncStore';
import type { KickCountSessionRecord } from './kickCountTypes';
import { SafetyStrip } from './KickCountHomeScreen';
import { T } from '../theme/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, 'KickCountSummary'>;
type Route = NativeStackScreenProps<RootStackParamList, 'KickCountSummary'>['route'];

export function KickCountSummaryScreen() {
  const { t } = useT();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { sessionId } = route.params;

  const [session, setSession] = useState<KickCountSessionRecord | null>(null);

  useEffect(() => {
    const s = kickCountSyncStore.getSession(sessionId);
    setSession(s ?? null);
  }, [sessionId]);

  const handleViewHistory = () => navigation.navigate('KickCountHistory');
  const handleDone = () => navigation.navigate('KickCountHome');

  if (!session) {
    return (
      <View style={styles.container} testID="kick-summary-loading">
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  const durationMin = session.durationSeconds ? Math.round(session.durationSeconds / 60) : 0;

  return (
    <View style={styles.container} testID="kick-summary-screen">
      {/*
        K-5b: icon/book (not done stamp ◉).
        The book icon conveys "saved to record" — not "achieved target".
        Using text "📖" as placeholder; production would use icon/book glyph.
      */}
      <Text style={styles.bookIcon} accessibilityElementsHidden>📖</Text>

      <Text style={styles.headline}>{t('kick.summaryHeadline')}</Text>
      <Text style={styles.startedAt}>{session.startedAt.replace('T', '  ')}</Text>

      {/*
        K-5b summary box: count=3 and count=10 have IDENTICAL styling.
        roselle-900 heading color for all values — no conditional coloring.
        No "เก่งมาก!" / "ครบแล้ว!" copy (INV-K2).
      */}
      <View style={styles.statsBox} testID="kick-summary-stats">
        <View style={styles.statColumn}>
          <Text style={styles.statLabel}>{t('kick.summaryCountLabel')}</Text>
          {/* K-5b: "7 ครั้ง" — not "7/10" on summary (SC-K3 uses plain count) */}
          <Text style={styles.statValue} testID="kick-summary-count">
            {interpolate(t('kick.summaryCount'), { n: session.movementCount })}
          </Text>
        </View>
        {durationMin > 0 && (
          <View style={styles.statColumn}>
            <Text style={styles.statLabel}>{t('kick.summaryDurationLabel')}</Text>
            <Text style={styles.statValue} testID="kick-summary-duration">
              {interpolate(t('kick.summaryDuration'), { min: durationMin })}
            </Text>
          </View>
        )}
        {session.gestationalWeekAtStart != null && (
          <View style={styles.statColumn}>
            {/*
              B3 pre-build caption fix: week-range labels use type.caption (13sp)
              + text.primary (roselle-700, 6.98:1 on ivory-200 AAA). jade-600 is
              BANNED below 15sp (R4).
            */}
            <Text style={styles.statLabel}>{t('kick.detailWeekLabel')}</Text>
            <Text style={styles.statValue}>
              {interpolate(t('kick.weekLabel'), { n: session.gestationalWeekAtStart })}
            </Text>
          </View>
        )}
      </View>

      {/* Safety strip (K-5d) + disclaimer — always-on (INV-K6) */}
      <SafetyStrip t={t} />

      {/* Bottom actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleViewHistory}
          accessibilityRole="button"
          accessibilityLabel={t('kick.summaryViewHistory')}
          testID="kick-summary-view-history-btn"
        >
          <Text style={styles.secondaryBtnText}>{t('kick.summaryViewHistory')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleDone}
          accessibilityRole="button"
          accessibilityLabel={t('kick.summaryDone')}
          testID="kick-summary-done-btn"
        >
          <Text style={styles.primaryBtnText}>{t('kick.summaryDone')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,        // #FBF6F1 ivory-100 (from #FFFFFF)
    padding: T.spacing[4],                         // 16dp
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #6B6B6B)
    marginTop: 40,
  },
  // K-5b: icon/book — NOT done stamp ◉ (no sage/700)
  bookIcon: {
    fontSize: 42,
    marginTop: 24,
    marginBottom: 8,
  },
  headline: {
    fontFamily: T.type.heading2.fontFamily,        // Sarabun-SemiBold
    fontSize: T.type.heading2.size,                // 20sp (from 22sp — closest heading token)
    lineHeight: T.type.heading2.lineHeight,        // 33
    fontWeight: T.type.heading2.fontWeight,        // '600'
    color: T.color.text.heading,                   // #4A2230 roselle-900 (from #1A1A1A)
    marginBottom: 4,
  },
  startedAt: {
    // B3 pre-build caption fix: session metadata label — type.caption 13sp + text.primary
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular
    fontSize: T.type.caption.size,                 // 13sp (from 14sp — caption for metadata)
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (from #6B6B6B — not jade-600 at 13sp R4)
    marginBottom: 20,
  },
  // K-5b: stats box — identical styling for count=3 and count=10
  statsBox: {
    flexDirection: 'row',
    backgroundColor: T.color.surface.subtle,       // #F5EDE6 ivory-200 (from #F5F5F5)
    borderRadius: T.radius.md,                     // 12dp
    padding: T.spacing[4],                         // 16dp
    width: '100%',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statColumn: {
    alignItems: 'center',
  },
  statLabel: {
    // B3 pre-build caption fix: week-range / stat labels = type.caption 13sp + text.primary roselle-700
    fontFamily: T.type.caption.fontFamily,         // Sarabun-Regular
    fontSize: T.type.caption.size,                 // 13sp (from 12sp) — text.primary required at 13sp (R4)
    lineHeight: T.type.caption.lineHeight,         // 21
    color: T.color.text.primary,                   // #7A3A52 roselle-700 (6.98:1 on ivory-200 AAA; jade-600 BANNED at 13sp)
    marginBottom: 4,
  },
  statValue: {
    fontFamily: T.type.heading2.fontFamily,        // Sarabun-SemiBold (per spec "type.display or type.heading1")
    fontSize: T.type.heading2.size,                // 20sp (from 20sp — heading2 size)
    lineHeight: T.type.heading2.lineHeight,        // 33
    fontWeight: T.type.heading2.fontWeight,        // '600'
    color: T.color.text.heading,                   // #4A2230 roselle-900 (from #1A1A1A — STATIC per K-5b; no conditional coloring)
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 'auto',
    width: '100%',
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: T.button.primary.bg,         // #9A5F0A amber-700 (from #C0485F)
    borderRadius: T.button.primary.radius,         // 12dp
    height: T.button.primary.height,               // 52dp
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: T.type.label.fontFamily,           // Sarabun-SemiBold
    fontSize: T.type.body.size,                    // 15sp (from 16sp)
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.color.text.onDark,                    // #FFFFFF
    fontWeight: T.type.label.fontWeight,           // '600'
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: T.button.secondary.border,        // #E8DDD5 divider (from #C0485F — no rose border)
    borderRadius: T.button.secondary.radius,       // 12dp
    height: T.button.primary.height,               // 52dp
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: T.type.body.fontFamily,            // Sarabun-Regular
    fontSize: T.type.body.size,                    // 15sp
    lineHeight: T.type.body.lineHeight,            // 25
    color: T.button.secondary.text,                // #7A3A52 roselle-700 (from #C0485F — no rose text)
  },
});
