/**
 * SC-K4: KickCountHistoryScreen — session history list + daily bar chart.
 *
 * Layout (top → bottom):
 *   1. Date-range picker (from–to with quick presets 7/14/30 วัน)
 *   2. Daily bar chart (react-native-svg, amber bars, ห้องแม่ design)
 *   3. Session list grouped by civil date, filtered to selected range
 *
 * K-5c rules (testable — all rows must look identical):
 *   - All rows: background surface/base (ivory-100), text color roselle-700
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
import { T } from '../theme/tokens';

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
      // Enforce max span: pull from forward when span > MAX_RANGE_DAYS (to stays)
      const spanned = enforceMaxSpan(clampedFrom, clampedTo);
      setToDate(clampedTo);
      setFromDate(spanned);
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
              K-5c: all columns use the SAME text tokens (roselle-700).
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
    backgroundColor: T.color.surface.base,       // #FBF6F1 ivory-100 (from #FFFFFF)
  },
  loadingText: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular
    fontSize: T.type.body.size,                   // 15sp
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #6B6B6B)
    marginTop: 40,
    textAlign: 'center',
  },
  emptyHeadline: {
    fontFamily: T.type.heading2.fontFamily,       // Sarabun-SemiBold
    fontSize: T.type.heading2.size,               // 20sp (from 18sp)
    lineHeight: T.type.heading2.lineHeight,       // 33
    fontWeight: T.type.heading2.fontWeight,       // '600'
    color: T.color.text.heading,                  // #4A2230 roselle-900 (from #1A1A1A)
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 8,
  },
  emptyBody: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular
    fontSize: T.type.body.size,                   // 15sp (from 14sp, body for readability)
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #6B6B6B)
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: T.button.primary.bg,        // #9A5F0A amber-700 (from #C0485F)
    borderRadius: T.button.primary.radius,        // 12dp
    height: T.button.primary.height,              // 52dp
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
  },
  primaryBtnText: {
    fontFamily: T.type.label.fontFamily,          // Sarabun-SemiBold
    fontSize: T.type.body.size,                   // 15sp (from 16sp — body size for button text)
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.onDark,                   // #FFFFFF (from #FFFFFF)
    fontWeight: T.type.label.fontWeight,          // '600'
  },
  postpartumBanner: {
    backgroundColor: T.color.surface.subtle,      // #F5EDE6 ivory-200 (from #F5F5F5)
    borderRadius: T.radius.sm,                    // 6dp (from 8dp)
    padding: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  postpartumBannerText: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular
    fontSize: T.type.body.size,                   // 15sp (from 13sp — body per spec)
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #6B6B6B)
    textAlign: 'center',
  },

  // ── Date-range picker ──────────────────────────────────────────────────────
  rangeSection: {
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingTop: T.spacing[4],                     // 16dp
    paddingBottom: 8,
  },
  rangeSectionLabel: {
    fontFamily: T.type.label.fontFamily,          // Sarabun-SemiBold (section label)
    fontSize: T.type.label.size,                  // 15sp — NO uppercase (Thai rule)
    lineHeight: T.type.label.lineHeight,          // 24
    fontWeight: T.type.label.fontWeight,          // '600'
    color: T.color.text.botanical,                // #2F5042 jade-800 (from #5F4A52)
    marginBottom: 8,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  presetChip: {
    borderRadius: T.radius.pill,                  // 999
    borderWidth: 1,
    borderColor: T.color.surface.divider,         // #E8DDD5 (from #E3D8CE)
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipText: {
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular
    fontSize: T.type.caption.size,                // 13sp (from 12sp)
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #5F4A52 — not jade-600 at 13sp R4)
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pickerField: {
    flex: 1,
  },
  pickerLabel: {
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular
    fontSize: T.type.caption.size,                // 13sp (from 11sp)
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.primary,                  // #7A3A52 (from #6B6B6B — not jade-600 at 13sp R4)
    marginBottom: 4,
  },
  pickerBtn: {
    backgroundColor: T.input.bg,                 // #F5EDE6 ivory-200 (from #FAFAFA)
    borderWidth: 1,
    borderColor: T.input.border.default,          // #E8DDD5 (from #E3D8CE)
    borderRadius: T.radius.sm,                   // 6dp (from 8dp)
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
  },
  pickerBtnText: {
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular (tabular monospace for date)
    fontSize: T.type.caption.size,               // 13sp (from 13sp)
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.heading,                  // #4A2230 roselle-900 (from #1A1A1A)
  },

  // ── Chart ──────────────────────────────────────────────────────────────────
  chartSection: {
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingBottom: 8,
  },
  chartTitle: {
    fontFamily: T.type.label.fontFamily,          // Sarabun-SemiBold (section label)
    fontSize: T.type.label.size,                  // 15sp — NO uppercase (Thai rule)
    lineHeight: T.type.label.lineHeight,          // 24
    fontWeight: T.type.label.fontWeight,          // '600'
    color: T.color.text.botanical,                // #2F5042 jade-800 (from #5F4A52)
    marginBottom: 8,
  },
  chartContainer: {
    borderRadius: T.radius.sm,                    // 6dp (from 8dp)
    overflow: 'hidden',
  },

  // ── Range empty state (list portion only) ─────────────────────────────────
  rangeEmptyState: {
    paddingHorizontal: T.spacing[4],              // 16dp
    paddingVertical: 12,
    alignItems: 'center',
  },
  rangeEmptyText: {
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular
    fontSize: T.type.caption.size,                // 13sp (from 13sp)
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.primary,                  // #7A3A52 (from #6B6B6B — not jade-600 at 13sp R4)
    textAlign: 'center',
  },

  // ── Session list ────────────────────────────────────────────────────────────
  list: {
    flex: 1,
  },
  listSectionLabel: {
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular
    fontSize: T.type.caption.size,                // 13sp
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #6B6B6B — not jade-600 at 13sp R4)
    fontWeight: '600',
    paddingVertical: 6,
    paddingHorizontal: T.spacing[4],              // 16dp
  },
  sectionHeader: {
    fontFamily: T.type.heading2.fontFamily,       // Sarabun-SemiBold (section date heading)
    fontSize: T.type.heading2.size,               // 20sp — per spec "type.heading2 text.heading 20sp"
    lineHeight: T.type.heading2.lineHeight,       // 33
    fontWeight: T.type.heading2.fontWeight,       // '600'
    color: T.color.text.heading,                  // #4A2230 roselle-900
    paddingVertical: 8,
    paddingHorizontal: T.spacing[4],              // 16dp
  },
  // K-5c: session row — IDENTICAL styling regardless of movementCount
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.color.surface.base,        // #FBF6F1 ivory-100 (from #FFFFFF — K-5c same for ALL rows)
    borderRadius: T.radius.sm,                    // 6dp (from 8dp)
    paddingVertical: 14,
    paddingHorizontal: T.spacing[4],              // 16dp
    minHeight: T.list.row.minHeight,              // 56dp
    marginBottom: 1,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,   // #E8DDD5 (from #F0F0F0)
    // NO left border accent (K-5c: ห้ามใช้ status/attention accent bar)
  },
  rowTime: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular (tabular for time display)
    fontSize: T.type.body.size,                   // 15sp (from 15sp)
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (K-5c SAME for all rows)
    marginRight: 8,
    minWidth: 48,
  },
  rowCount: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular
    fontSize: T.type.body.size,                   // 15sp
    lineHeight: T.type.body.lineHeight,           // 25
    fontWeight: '600',
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (K-5c SAME regardless of count value)
    marginRight: 4,
  },
  rowDuration: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular
    fontSize: T.type.body.size,                   // 15sp (from 14sp — body for legibility)
    lineHeight: T.type.body.lineHeight,           // 25
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (K-5c SAME for all rows)
    flex: 1,
  },
  rowWeek: {
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular
    fontSize: T.type.caption.size,                // 13sp (from 12sp)
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #9B9B9B — not jade-600 at 13sp R4; K-5c SAME)
    marginRight: 8,
  },
  rowChevron: {
    fontFamily: T.type.body.fontFamily,           // Sarabun-Regular
    fontSize: T.type.body.size,                   // 15sp (from 16sp)
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from #9B9B9B)
  },
});
