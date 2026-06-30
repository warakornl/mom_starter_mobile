/**
 * SC-K3: KickCountSummaryScreen — post-finalize session summary.
 *
 * K-5b invariants (testable):
 *   - icon/book (not done stamp ◉ / no sage/700 color)
 *   - No celebratory copy ("เก่งมาก!", "ครบแล้ว!")
 *   - count=3 and count=10 produce identical UI — only the number differs
 *   - All values displayed with ink color — no status/conditional coloring
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
        ink color for all values — no conditional coloring.
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
    backgroundColor: '#FFFFFF',
    padding: 16,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 15,
    color: '#6B6B6B',
    marginTop: 40,
  },
  // K-5b: icon/book — NOT done stamp ◉ (no sage/700)
  bookIcon: {
    fontSize: 42,
    marginTop: 24,
    marginBottom: 8,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  startedAt: {
    fontSize: 14,
    color: '#6B6B6B',
    marginBottom: 20,
  },
  // K-5b: stats box — identical styling for count=3 and count=10
  statsBox: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statColumn: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#9B9B9B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A', // ink — same color regardless of count (K-5b)
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 'auto',
    width: '100%',
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#C0485F',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#C0485F',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#C0485F',
    fontSize: 15,
  },
});
