/**
 * SC-K4: KickCountHistoryScreen — session history list + daily bar chart.
 *
 * Layout (top → bottom):
 *   1. Date-range picker (from–to with quick presets 7/14/30 วัน)
 *   2. Daily bar chart (react-native-svg, rose bars, Clean design)
 *   3. Session list grouped by civil date, filtered to selected range
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
 * K-8: NEVER log session data (movementCount, startedAt, etc.) — MOTHER-health data.
 * SD-9: navigation passes only sessionId to KickCountDetail (no health fields).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { interpolate } from '../i18n/messages';
import { kickCountSyncStore } from './kickCountSyncStore';
import type { KickCountSessionRecord } from './kickCountTypes';
import { isStartAllowedByWeek } from './kickCountLogic';
import type { Lifecycle } from '../pregnancy/types';
import { buildDailyKickTotals } from './kickCountDailyTotals';
import { KickCountDailyChart, buildChartA11yLabel } from './KickCountDailyChart';
import {
  buildDefaultFromDate,
  buildDefaultToDate,
  clampToDate,
  clampFromDate,
  enforceMaxSpan,
  filterSessionsToRange,
  fromDateForPreset,
} from './kickCountHistoryChartHelpers';

type Nav = NativeStackNavigationProp<RootStackParamList, 'KickCountHistory'>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface KickCountHistoryScreenProps {
  gestationalWeek: number;
  lifecycle: Lifecycle;
  generalHealthConsented: boolean;
  onRequestConsent: () => void;
}

// ─── Civil date helpers ───────────────────────────────────────────────────────

/** Extract "YYYY-MM-DD" civil date from a floating-civil "YYYY-MM-DDTHH:mm". */
function datePart(floatingCivil: string): string {
  return floatingCivil.split('T')[0] ?? floatingCivil;
}

/** Extract "HH:MM" from a floating-civil "YYYY-MM-DDTHH:mm". */
function timePart(floatingCivil: string): string {
  return floatingCivil.split('T')[1] ?? '';
}

/** Format a JS Date as "YYYY-MM-DD" using local date components. */
function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Parse "YYYY-MM-DD" to a JS Date at local midnight. */
function parseCivilDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Get today as "YYYY-MM-DD" from device local time. */
function todayCivil(): string {
  return toLocalYMD(new Date());
}

// ─── Grouping for session list ────────────────────────────────────────────────

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
  // Sorted by date descending (most recent first)
  const dates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
  return dates.map((date) => ({ date, sessions: map.get(date)! }));
}

// ─── Chart width sentinel ─────────────────────────────────────────────────────

const CHART_FALLBACK_WIDTH = 320;

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
  const [chartWidth, setChartWidth] = useState(CHART_FALLBACK_WIDTH);

  // ── Date-range state (last 7 days default) ───────────────────────────────────
  const today = todayCivil();
  const [fromDate, setFromDate] = useState(() => buildDefaultFromDate(today));
  const [toDate, setToDate] = useState(() => buildDefaultToDate(today));

  // iOS: show picker inline by toggling visibility
  // Android: picker is modal — track which field is active
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const canStart = isStartAllowedByWeek(gestationalWeek, lifecycle);

  useEffect(() => {
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

  // SD-9: navigate with sessionId only — no health fields in route params
  const handleRowPress = useCallback((session: KickCountSessionRecord) => {
    navigation.navigate('KickCountDetail', { sessionId: session.id });
  }, [navigation]);

  // ── Preset handlers ─────────────────────────────────────────────────────────

  const applyPreset = useCallback((days: number) => {
    const newTo = clampToDate(today, today);
    const newFrom = fromDateForPreset(newTo, days);
    setFromDate(newFrom);
    setToDate(newTo);
    setShowFromPicker(false);
    setShowToPicker(false);
  }, [today]);

  // ── From picker handlers ─────────────────────────────────────────────────────

  const handleFromPickerChange = useCallback(
    (_event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS === 'android') {
        setShowFromPicker(false);
      }
      if (!selected) return;
      const raw = toLocalYMD(selected);
      const clamped = clampFromDate(raw, toDate);
      const spanned = enforceMaxSpan(clamped, toDate);
      setFromDate(spanned);
    },
    [toDate],
  );

  // ── To picker handlers ───────────────────────────────────────────────────────

  const handleToPickerChange = useCallback(
    (_event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS === 'android') {
        setShowToPicker(false);
      }
      if (!selected) return;
      const raw = toLocalYMD(selected);
      // toDate must not exceed today
      const clampedTo = clampToDate(raw, today);
      // fromDate must be ≤ toDate
      const clampedFrom = clampFromDate(fromDate, clampedTo);
      setToDate(clampedTo);
      setFromDate(clampedFrom);
    },
    [fromDate, today],
  );

  // ── Derived data (memoised to avoid re-computation on each render) ────────────

  const filteredSessions = filterSessionsToRange(sessions, fromDate, toDate);
  const dailyTotals = buildDailyKickTotals(filteredSessions, fromDate, toDate);
  const maxTotal = dailyTotals.length > 0
    ? Math.max(...dailyTotals.map((d) => d.totalCount))
    : 0;
  const chartA11yLabel = buildChartA11yLabel(
    t('kick.chartA11y'),
    dailyTotals.length,
    maxTotal,
  );
  const groups = groupByDate(filteredSessions);
  const rangeIsEmpty = filteredSessions.length === 0;

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.container} testID="kick-history-loading">
        <Text style={styles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  // ── Empty state (no sessions in store at all) ─────────────────────────────────

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

  // ── Main content: chart + range picker at top; filtered session list below ────

  const renderListHeader = () => (
    <>
      {/* SC-K6b postpartum read-only banner */}
      {lifecycle === 'postpartum' && (
        <View style={styles.postpartumBanner} testID="kick-history-postpartum-banner">
          <Text style={styles.postpartumBannerText}>{t('kick.postpartumBanner')}</Text>
        </View>
      )}

      {/* ── Date-range picker ─────────────────────────────────────────────── */}
      <View style={styles.rangeSection} testID="kick-chart-range-section">
        <Text style={styles.rangeSectionLabel}>{t('kick.chartDateRange')}</Text>

        {/* Quick preset chips */}
        <View style={styles.presetRow}>
          {([7, 14, 30] as const).map((days) => {
            const key = `kick.chart${days}d` as
              | 'kick.chart7d'
              | 'kick.chart14d'
              | 'kick.chart30d';
            return (
              <TouchableOpacity
                key={days}
                style={styles.presetChip}
                onPress={() => applyPreset(days)}
                accessibilityRole="button"
                accessibilityLabel={t(key)}
                testID={`kick-chart-preset-${days}`}
              >
                <Text style={styles.presetChipText}>{t(key)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* From / To date buttons */}
        <View style={styles.pickerRow}>
          {/* From */}
          <View style={styles.pickerField}>
            <Text style={styles.pickerLabel}>{t('kick.chartFrom')}</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => {
                setShowToPicker(false);
                setShowFromPicker((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t('kick.chartFrom')} ${fromDate}`}
              testID="kick-chart-from-btn"
            >
              <Text style={styles.pickerBtnText}>{fromDate}</Text>
            </TouchableOpacity>
            {showFromPicker && (
              <DateTimePicker
                value={parseCivilDate(fromDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                maximumDate={parseCivilDate(toDate)}
                onChange={handleFromPickerChange}
                testID="kick-chart-from-picker"
              />
            )}
          </View>

          {/* To */}
          <View style={styles.pickerField}>
            <Text style={styles.pickerLabel}>{t('kick.chartTo')}</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => {
                setShowFromPicker(false);
                setShowToPicker((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t('kick.chartTo')} ${toDate}`}
              testID="kick-chart-to-btn"
            >
              <Text style={styles.pickerBtnText}>{toDate}</Text>
            </TouchableOpacity>
            {showToPicker && (
              <DateTimePicker
                value={parseCivilDate(toDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                maximumDate={parseCivilDate(today)}
                minimumDate={parseCivilDate(fromDate)}
                onChange={handleToPickerChange}
                testID="kick-chart-to-picker"
              />
            )}
          </View>
        </View>
      </View>

      {/* ── Daily bar chart ───────────────────────────────────────────────── */}
      <View style={styles.chartSection} testID="kick-chart-section">
        <Text style={styles.chartTitle}>{t('kick.chartTitle')}</Text>
        <View
          style={styles.chartContainer}
          onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
        >
          <KickCountDailyChart
            data={dailyTotals}
            width={chartWidth}
            height={180}
            accessibilityLabel={chartA11yLabel}
            emptyLabel={t('kick.chartEmpty')}
          />
        </View>
      </View>

      {/* ── Range-empty message ───────────────────────────────────────────── */}
      {rangeIsEmpty && (
        <View style={styles.rangeEmptyState} testID="kick-chart-range-empty">
          <Text style={styles.rangeEmptyText}>{t('kick.chartEmpty')}</Text>
        </View>
      )}

      {/* ── Session list section header ───────────────────────────────────── */}
      {!rangeIsEmpty && (
        <Text style={styles.listSectionLabel}>
          {fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
        </Text>
      )}
    </>
  );

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
      <FlatList
        data={groups}
        keyExtractor={(g) => g.date}
        renderItem={renderItem}
        ListHeaderComponent={renderListHeader}
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
    marginBottom: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  postpartumBannerText: {
    fontSize: 13,
    color: '#6B6B6B',
    textAlign: 'center',
  },

  // ── Date-range picker ──────────────────────────────────────────────────────
  rangeSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  rangeSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F4A52',          // T.sectionLabelColor
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  presetChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E3D8CE',    // T.hairline
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipText: {
    fontSize: 12,
    color: '#5F4A52',
    fontWeight: '500',
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pickerField: {
    flex: 1,
  },
  pickerLabel: {
    fontSize: 11,
    color: '#6B6B6B',
    marginBottom: 4,
  },
  pickerBtn: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E3D8CE',    // T.hairline
    borderRadius: 8,           // T.cardRadius
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pickerBtnText: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#1A1A1A',
  },

  // ── Chart ──────────────────────────────────────────────────────────────────
  chartSection: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chartTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F4A52',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chartContainer: {
    borderRadius: 8,
    overflow: 'hidden',
  },

  // ── Range empty state (list portion only) ─────────────────────────────────
  rangeEmptyState: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  rangeEmptyText: {
    fontSize: 13,
    color: '#6B6B6B',
    textAlign: 'center',
  },

  // ── Session list ────────────────────────────────────────────────────────────
  list: {
    flex: 1,
  },
  listSectionLabel: {
    fontSize: 13,
    color: '#6B6B6B',
    fontWeight: '600',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    fontSize: 13,
    color: '#6B6B6B',
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  // K-5c: session row — IDENTICAL styling regardless of movementCount
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF', // surface/page — same for ALL rows (K-5c)
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
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
