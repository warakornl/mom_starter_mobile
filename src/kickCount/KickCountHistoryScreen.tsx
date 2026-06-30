/**
 * SC-K4: KickCountHistoryScreen — session history list.
 *
 * K-5c rules (testable — all rows must look identical):
 *   - All rows: background surface/page (#FFFFFF), text color ink (#1A1A1A)
 *   - No badge/pill/icon/left-accent per row based on count value
 *   - No sort/group by count size — group by civil date of startedAt only (D10)
 *   - row count=3 and row count=10 produce IDENTICAL rendered appearance
 *
 * D6 / SC-K6b (postpartum):
 *   - read-only banner shown
 *   - no "เริ่มนับ" button
 *
 * Data source: kickCountSyncStore.getActiveSessions() (local-first).
 * "Start Counting" button in empty state has the same consent gate as SC-K0.
 *
 * Security: never log session data (K-8 MOTHER-health).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { kickCountSyncStore } from './kickCountSyncStore';
import type { KickCountSessionRecord } from './kickCountTypes';
import { isStartAllowedByWeek } from './kickCountLogic';
import type { Lifecycle } from '../pregnancy/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'KickCountHistory'>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface KickCountHistoryScreenProps {
  gestationalWeek: number;
  lifecycle: Lifecycle;
  generalHealthConsented: boolean;
  onRequestConsent: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract "YYYY-MM-DD" civil date from a floating-civil "YYYY-MM-DDTHH:mm". */
function datePart(floatingCivil: string): string {
  return floatingCivil.split('T')[0] ?? floatingCivil;
}

/** Extract "HH:MM" from a floating-civil "YYYY-MM-DDTHH:mm". */
function timePart(floatingCivil: string): string {
  return floatingCivil.split('T')[1] ?? '';
}

interface DateGroup {
  date: string;
  sessions: KickCountSessionRecord[];
}

/** Group sessions by civil date of startedAt (D10 / FLAG-1). */
function groupByDate(sessions: KickCountSessionRecord[]): DateGroup[] {
  const map = new Map<string, KickCountSessionRecord[]>();
  for (const s of sessions) {
    const d = datePart(s.startedAt);
    const group = map.get(d) ?? [];
    group.push(s);
    map.set(d, group);
  }
  // Sorted by date descending (sessions are already sorted desc by startedAt)
  const dates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
  return dates.map((date) => ({ date, sessions: map.get(date)! }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KickCountHistoryScreen({
  gestationalWeek,
  lifecycle,
  generalHealthConsented,
  onRequestConsent,
}: KickCountHistoryScreenProps) {
  const { t } = useT();
  const navigation = useNavigation<Nav>();

  const [sessions, setSessions] = useState<KickCountSessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const canStart = isStartAllowedByWeek(gestationalWeek, lifecycle);

  useEffect(() => {
    // Load from local store (offline-first; D10)
    const active = kickCountSyncStore.getActiveSessions();
    setSessions(active);
    setIsLoading(false);
  }, []);

  const handleStartPress = useCallback(() => {
    if (!generalHealthConsented) {
      onRequestConsent();
      return;
    }
    navigation.navigate('KickCountCounting');
  }, [generalHealthConsented, navigation, onRequestConsent]);

  const handleRowPress = useCallback((session: KickCountSessionRecord) => {
    navigation.navigate('KickCountDetail', { sessionId: session.id });
  }, [navigation]);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.container} testID="kick-history-loading">
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (sessions.length === 0) {
    return (
      <View style={styles.container} testID="kick-history-empty">
        {lifecycle === 'postpartum' && (
          <View style={styles.postpartumBanner} testID="kick-history-postpartum-banner">
            <Text style={styles.postpartumBannerText}>{t('kick.postpartumBanner')}</Text>
          </View>
        )}
        <Text style={styles.emptyHeadline}>{t('kick.historyEmpty')}</Text>
        <Text style={styles.emptyBody}>{t('kick.historyEmptyBody')}</Text>
        {/* SC-K4-Empty: "เริ่มนับ" with same consent gate as SC-K0 */}
        {canStart && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleStartPress}
            accessibilityRole="button"
            accessibilityLabel={t('kick.startBtn')}
            testID="kick-history-start-btn"
          >
            <Text style={styles.primaryBtnText}>{t('kick.startBtn')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Session list (grouped by civil date — K-5c all rows identical) ───────────

  const groups = groupByDate(sessions);

  const renderItem = ({ item: group }: { item: DateGroup }) => (
    <View key={group.date}>
      {/* Section header: civil date only (D10) */}
      <Text style={styles.sectionHeader} testID={`kick-section-${group.date}`}>
        {group.date}
      </Text>
      {group.sessions.map((s) => {
        const durationMin = s.durationSeconds ? Math.round(s.durationSeconds / 60) : 0;
        return (
          <TouchableOpacity
            key={s.id}
            style={styles.sessionRow}
            onPress={() => handleRowPress(s)}
            accessibilityRole="button"
            accessibilityLabel={interpolate(t('kick.historyRowA11y'), {
              time: timePart(s.startedAt),
              n: s.movementCount,
              min: durationMin,
              wk: s.gestationalWeekAtStart ?? '—',
            })}
            testID={`kick-history-row-${s.id}`}
            // K-5c: ALL rows are visually identical — no per-row style variation
          >
            {/*
              K-5c: all columns use the SAME text tokens (ink/ink-soft/ink-faint).
              row with count=3 and row with count=10 have identical appearance.
              No badge, no left-accent, no highlight.
            */}
            <Text style={styles.rowTime}>{timePart(s.startedAt)}</Text>
            <Text style={styles.rowCount}>
              {interpolate(t('kick.rowCount'), { n: s.movementCount })}
            </Text>
            {durationMin > 0 && (
              <Text style={styles.rowDuration}>
                · {interpolate(t('kick.rowDuration'), { min: durationMin })}
              </Text>
            )}
            {s.gestationalWeekAtStart != null && (
              <Text style={styles.rowWeek}>
                {interpolate(t('kick.weekLabel'), { n: s.gestationalWeekAtStart })}
              </Text>
            )}
            <Text style={styles.rowChevron}>›</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={styles.container} testID="kick-history-list">
      {/* SC-K6b postpartum read-only banner */}
      {lifecycle === 'postpartum' && (
        <View style={styles.postpartumBanner} testID="kick-history-postpartum-banner">
          <Text style={styles.postpartumBannerText}>{t('kick.postpartumBanner')}</Text>
        </View>
      )}

      <FlatList
        data={groups}
        keyExtractor={(g) => g.date}
        renderItem={renderItem}
        style={styles.list}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  loadingText: {
    fontSize: 15,
    color: '#6B6B6B',
    marginTop: 40,
    textAlign: 'center',
  },
  emptyHeadline: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: '#6B6B6B',
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: '#C0485F',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  postpartumBanner: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  postpartumBannerText: {
    fontSize: 13,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 13,
    color: '#6B6B6B',
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  // K-5c: session row — IDENTICAL styling regardless of movementCount
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF', // surface/page — same for ALL rows (K-5c)
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    minHeight: 56,
    marginBottom: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    // NO left border accent (K-5c: ห้ามใช้ status/attention accent bar)
  },
  rowTime: {
    fontSize: 15,
    fontFamily: 'monospace',
    color: '#1A1A1A', // ink — SAME for all rows (K-5c)
    marginRight: 8,
    minWidth: 48,
  },
  rowCount: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A', // ink — SAME regardless of count value (K-5c)
    marginRight: 4,
  },
  rowDuration: {
    fontSize: 14,
    color: '#6B6B6B', // ink/soft — SAME for all rows (K-5c)
    flex: 1,
  },
  rowWeek: {
    fontSize: 12,
    color: '#9B9B9B', // ink/faint — SAME for all rows (K-5c)
    marginRight: 8,
  },
  rowChevron: {
    fontSize: 16,
    color: '#9B9B9B',
  },
});
