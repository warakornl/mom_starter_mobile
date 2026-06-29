/**
 * CalendarScreen — monthly calendar + agenda view.
 *
 * Combines three local-store sources (FLAG-1: all bucketed on floating-civil date):
 *   1. ChecklistItems (appointments/ANC/tasks) — from calendarSyncStore
 *   2. ReminderOccurrences — materialized done/snoozed from calendarSyncStore
 *   3. Projected occurrences — computed client-side from active Reminders via
 *      the FLAG-4 expander (recurrenceExpander.ts); never stored as rows (W-A)
 *
 * Projection window: today → today + PROJECTION_DAYS (60 days).
 * // TODO(slice-next): extend projection window backwards to show missed past
 * //   occurrences on the grid. MVP scope = today forward only.
 * Dedup: projected ↔ materialized merge by deterministic occurrence id —
 * materialized wins (dedupOccurrences from dedup.ts).
 * Missed: derived end-of-day on-device (occurrences before today with no
 * done/snoozed row derive status='missed').
 * Daily indicator per cell: indicatorPrecedence.ts.
 *
 * Sync:
 *   - Pull runs on mount + AppState 'active' (repopulates store from server).
 *   - Push triggered on: mark done/snooze occurrence (enqueueOccurrence →
 *     executePush). Pattern mirrors SuppliesScreen.
 *   - executePush drains calendarSyncStore queue, pushes, re-enqueues on fail
 *     or rejected[] (no silent mutation loss).
 *
 * Screen states (spec §C):
 *   loading    — skeleton while store is seeding (brief; in-memory)
 *   populated  — monthly grid + selected-day agenda
 *   empty      — no items on selected day
 *   offline    — banner; data still displayed from local store
 *
 * Navigation:
 *   → AppointmentFormScreen  (+ new appointment / tap existing appointment)
 *   → ReminderFormScreen     (+ new reminder / tap existing reminder)
 *
 * Mark done/snoozed (FLAG-7/W-A):
 *   Tapping a due/snoozed occurrence → Alert → mark done / snooze
 *   → calendarSyncStore.enqueueOccurrence() → executePush (fire-and-forget)
 *   TODO carry-forward: OS notification firing (expo-notifications not added)
 *
 * Design tokens (design-system.md):
 *   bg/warm-milk  #FBF6F1  surface/page  #FFFFFF  ink  #3A2A30
 *   rose/600      #A8505A  hairline      #EBE1D9
 *   teal/500      #3B8C8C  (reminder dots)
 *   sage/600      #4A7A56  (checklist/done dots)
 *
 * Security: no health data logged.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  SafeAreaView,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useT } from '../i18n/LanguageContext';
import { formatCivilDate } from '../i18n/messages';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { createCalendarSyncClient } from '../sync/syncClient';
import { executePush } from '../sync/pushOrchestrator';
import { expand } from '../recurrence/recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import { bucketCivilDay } from './civilDayBucketer';
import { dedupOccurrences } from './dedup';
import type { TokenStorage } from '../auth/tokenStorage';
import type { ChecklistItemRecord, ReminderOccurrenceRecord, OccurrenceStatus } from '../sync/syncTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECTION_DAYS = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A calendar item shown in the agenda for a selected day. */
export type CalendarItem =
  | { kind: 'checklist'; item: ChecklistItemRecord }
  | {
      kind: 'occurrence';
      id: string;
      reminderId: string;
      scheduledLocalTime: string;
      displayTitle: string;
      status: OccurrenceStatus;
      materialized: boolean;
    };

// ─── Civil date helpers ───────────────────────────────────────────────────────

function localCivilToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(isoDate: string, n: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Returns all calendar days in the month that contains `isoDate`. */
function monthDays(isoDate: string): string[] {
  const [y, m] = isoDate.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

/** Day-of-week index (0=Sun..6=Sat) for the first day of `isoDate`'s month. */
function monthStartDow(isoDate: string): number {
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}

// ─── Projection logic ─────────────────────────────────────────────────────────

/**
 * Project all reminder occurrences in [today, today+PROJECTION_DAYS].
 * Returns a map of civil-date → projected occurrence items.
 * Merged with materialized (done/snoozed) rows via dedup (materialized wins).
 */
function buildProjectedItems(today: string): Map<string, CalendarItem[]> {
  const windowEnd = addDays(today, PROJECTION_DAYS);
  const reminders = calendarSyncStore.getActiveReminders();
  const result = new Map<string, CalendarItem[]>();

  for (const reminder of reminders) {
    // Build expander rule from reminder fields
    const rule = {
      ...reminder.recurrenceRule,
      startAt: reminder.startAt,
    };

    const civilStrings = expand(rule, today, windowEnd);

    // Lookup materialized rows for this reminder
    const materializedRows = calendarSyncStore.getOccurrencesForReminder(reminder.id);
    const materializedById = new Map(materializedRows.map((r) => [r.id, r]));

    // Build projected items, then dedup with materialized
    interface RawOcc {
      id: string;
      reminderId: string;
      scheduledLocalTime: string;
      displayTitle: string;
      status: OccurrenceStatus;
      materialized: boolean;
    }

    const projected: RawOcc[] = civilStrings.map((civil) => {
      const id = computeOccurrenceId(reminder.id, civil);
      const materialized = materializedById.get(id);
      // Dead code removed (🟡 cleanup): `date` and `isMissed` were unused here.
      const isPastDate = bucketCivilDay(civil) < today;

      return {
        id,
        reminderId: reminder.id,
        scheduledLocalTime: civil,
        displayTitle: reminder.displayTitle,
        status: materialized
          ? materialized.status
          : isPastDate
          ? 'missed'
          : 'due',
        materialized: !!materialized,
      };
    });

    // Dedup projected + materialized by id (materialized wins)
    const allForReminder: typeof projected = [];
    for (const p of projected) {
      const mat = materializedById.get(p.id);
      if (mat) {
        allForReminder.push({ ...p, status: mat.status, materialized: true });
      } else {
        allForReminder.push(p);
      }
    }
    // Also include past materialized rows (done/snoozed) not in the projection window
    for (const mat of materializedRows) {
      const alreadyIncluded = allForReminder.some((a) => a.id === mat.id);
      if (!alreadyIncluded) {
        allForReminder.push({
          id: mat.id,
          reminderId: mat.reminderId,
          scheduledLocalTime: mat.scheduledLocalTime,
          displayTitle: reminder.displayTitle,
          status: mat.status,
          materialized: true,
        });
      }
    }

    for (const occ of allForReminder) {
      const date = bucketCivilDay(occ.scheduledLocalTime);
      const existing = result.get(date) ?? [];
      existing.push({ kind: 'occurrence', ...occ });
      result.set(date, existing);
    }
  }

  return result;
}

/** Build checklist items bucketed by their scheduledAt date. */
function buildChecklistItems(): Map<string, CalendarItem[]> {
  const result = new Map<string, CalendarItem[]>();
  const items = calendarSyncStore.getActiveChecklistItems();
  for (const item of items) {
    if (!item.scheduledAt) continue;
    const date = bucketCivilDay(item.scheduledAt);
    const existing = result.get(date) ?? [];
    existing.push({ kind: 'checklist', item });
    result.set(date, existing);
  }
  return result;
}

// ─── Status label helper ─────────────────────────────────────────────────────

import type { MessageKey } from '../i18n/messages';

function occurrenceStatusLabel(
  status: OccurrenceStatus,
  t: (key: MessageKey) => string,
): string {
  const keyMap: Record<OccurrenceStatus, MessageKey> = {
    due: 'calendar.status.due',
    done: 'calendar.status.done',
    snoozed: 'calendar.status.snoozed',
    missed: 'calendar.status.missed',
  };
  return t(keyMap[status]);
}

// ─── Dot indicator per day ────────────────────────────────────────────────────

type DotColor = 'rose' | 'teal' | 'sage' | 'none';

function dayDotColor(items: CalendarItem[]): DotColor {
  if (items.length === 0) return 'none';
  // missed → rose (urgent)
  const hasMissed = items.some(
    (i) => i.kind === 'occurrence' && i.status === 'missed',
  );
  if (hasMissed) return 'rose';
  // due → teal
  const hasDue = items.some(
    (i) => i.kind === 'occurrence' && i.status === 'due',
  );
  if (hasDue) return 'teal';
  // done/checklist → sage
  return 'sage';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CalendarScreenProps {
  /** Token storage for auth — required for sync push/pull. */
  tokenStorage: TokenStorage;
  /** API base URL (e.g. "https://api.example.com"). */
  apiBaseUrl: string;
  onAddAppointment?: () => void;
  onEditAppointment?: (itemId: string) => void;
  onAddReminder?: () => void;
  onEditReminder?: (reminderId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarScreen({
  tokenStorage,
  apiBaseUrl,
  onAddAppointment,
  onEditAppointment,
  onAddReminder,
  onEditReminder,
}: CalendarScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const today = localCivilToday();

  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [displayMonth, setDisplayMonth] = useState<string>(today.slice(0, 7) + '-01');

  // refreshKey forces useMemo to rebuild maps after pull or occurrence action
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Calendar sync client — bound to calendarSyncStore singleton
  const clientRef = useRef(createCalendarSyncClient(apiBaseUrl, calendarSyncStore));

  // Refresh display maps from store (triggers useMemo re-run via refreshKey)
  const refreshFromStore = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ── Sync pull ──────────────────────────────────────────────────────────────

  const syncPull = useCallback(async () => {
    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    setSyncing(true);
    setSyncError(null);

    const result = await clientRef.current.pull(
      tokens.accessToken,
      calendarSyncStore.getWatermark(),
    );

    setSyncing(false);
    refreshFromStore();

    if (!result.ok) {
      // 403 consent_required → health consent not granted; app works offline
      setSyncError(t('calendar.syncError'));
    }
  }, [tokenStorage, refreshFromStore, t]);

  // ── Sync push ──────────────────────────────────────────────────────────────

  const syncPush = useCallback(async () => {
    if (calendarSyncStore.getPendingCount() === 0) return;

    const tokens = await tokenStorage.load();
    if (!tokens?.accessToken) return;

    // executePush drains queue, pushes, re-enqueues on fail/rejected (no silent loss)
    const result = await executePush(
      calendarSyncStore,
      clientRef.current,
      tokens.accessToken,
      uuidv4(),
    );

    refreshFromStore();

    if (!result.ok) {
      setSyncError(t('calendar.syncError'));
    }
    // Conflicts and rejected are handled by the store (adoptServerRecord /
    // reEnqueueChangeset) — no banner needed beyond the error case.
  }, [tokenStorage, refreshFromStore, t]);

  // ── Pull on mount and foreground ───────────────────────────────────────────

  useEffect(() => {
    void syncPull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next === 'active') {
        void syncPull();
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [syncPull]);

  // ── Build calendar maps ────────────────────────────────────────────────────

  // refreshKey in deps triggers rebuild after pull or occurrence action
  const { checklistMap, occurrenceMap } = useMemo(() => {
    const c = buildChecklistItems();
    const o = buildProjectedItems(today);
    return { checklistMap: c, occurrenceMap: o };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, refreshKey]);

  const getItemsForDate = useCallback(
    (date: string): CalendarItem[] => {
      const checklist = checklistMap.get(date) ?? [];
      const occurrences = occurrenceMap.get(date) ?? [];
      return [...checklist, ...occurrences].sort((a, b) => {
        const ta = a.kind === 'checklist' ? (a.item.scheduledAt ?? '') : a.scheduledLocalTime;
        const tb = b.kind === 'checklist' ? (b.item.scheduledAt ?? '') : b.scheduledLocalTime;
        return ta.localeCompare(tb);
      });
    },
    [checklistMap, occurrenceMap],
  );

  const selectedItems = getItemsForDate(selectedDate);

  // Monthly grid
  const days = useMemo(() => monthDays(displayMonth), [displayMonth]);
  const startDow = useMemo(() => monthStartDow(displayMonth), [displayMonth]);

  function handlePrevMonth() {
    const [y, m] = displayMonth.split('-').map(Number);
    const dt = new Date(y, m - 2, 1);
    setDisplayMonth(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`,
    );
  }

  function handleNextMonth() {
    const [y, m] = displayMonth.split('-').map(Number);
    const dt = new Date(y, m, 1);
    setDisplayMonth(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`,
    );
  }

  // Mark done / snooze for a reminder occurrence (FLAG-7/W-A)
  const handleOccurrenceAction = useCallback(
    (
      id: string,
      reminderId: string,
      scheduledLocalTime: string,
      displayTitle: string,
      currentStatus: OccurrenceStatus,
    ) => {
      if (currentStatus === 'done') return;

      Alert.alert(
        displayTitle,
        scheduledLocalTime,
        [
          {
            text: t('calendar.markDone'),
            onPress: () => {
              calendarSyncStore.enqueueOccurrence(
                reminderId,
                scheduledLocalTime,
                'done',
                new Date().toISOString(),
              );
              refreshFromStore();
              // Push immediately — fire-and-forget (no await to not block UI)
              void syncPush();
              // TODO carry-forward: cancel OS notification for this occurrence
            },
          },
          ...(currentStatus !== 'snoozed'
            ? [
                {
                  text: t('calendar.snooze1h'),
                  onPress: () => {
                    const snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                    calendarSyncStore.enqueueOccurrence(
                      reminderId,
                      scheduledLocalTime,
                      'snoozed',
                      new Date().toISOString(),
                      snoozedUntil,
                    );
                    refreshFromStore();
                    void syncPush();
                  },
                },
              ]
            : []),
          { text: t('general.cancel'), style: 'cancel' },
        ],
      );
    },
    [t, refreshFromStore, syncPush],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const [displayY, displayM] = displayMonth.split('-').map(Number);
  const monthLabel = formatCivilDate(`${displayMonth}`, locale);

  return (
    <SafeAreaView style={styles.container}>
      {/* Sync status banners */}
      {syncing && (
        <View style={styles.syncBar}>
          <Text style={styles.syncBarText}>{t('calendar.loading')}</Text>
        </View>
      )}
      {syncError && (
        <TouchableOpacity
          style={styles.errorBar}
          onPress={() => void syncPull()}
        >
          <Text style={styles.errorBarText}>{syncError}</Text>
        </TouchableOpacity>
      )}

      <ScrollView>
        {/* ── Month header ──────────────────────────────────────────────── */}
        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={handlePrevMonth} style={styles.monthArrow}>
            <Text style={styles.monthArrowText}>{'‹'}</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={handleNextMonth} style={styles.monthArrow}>
            <Text style={styles.monthArrowText}>{'›'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Day-of-week headers ───────────────────────────────────────── */}
        <View style={styles.dowRow}>
          {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => (
            <Text key={d} style={styles.dowLabel}>
              {d}
            </Text>
          ))}
        </View>

        {/* ── Day grid ─────────────────────────────────────────────────── */}
        <View style={styles.grid}>
          {/* Empty cells before month start */}
          {Array.from({ length: startDow }).map((_, i) => (
            <View key={`empty-${i}`} style={styles.dayCell} />
          ))}
          {days.map((date) => {
            const items = getItemsForDate(date);
            const dot = dayDotColor(items);
            const isToday = date === today;
            const isSelected = date === selectedDate;
            return (
              <TouchableOpacity
                key={date}
                style={[
                  styles.dayCell,
                  isSelected && styles.dayCellSelected,
                  isToday && styles.dayCellToday,
                ]}
                onPress={() => setSelectedDate(date)}
                accessibilityLabel={formatCivilDate(date, locale)}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    isToday && styles.dayNumberToday,
                    isSelected && styles.dayNumberSelected,
                  ]}
                >
                  {date.slice(8)}
                </Text>
                {dot !== 'none' && (
                  <View
                    style={[
                      styles.dot,
                      dot === 'rose' && styles.dotRose,
                      dot === 'teal' && styles.dotTeal,
                      dot === 'sage' && styles.dotSage,
                    ]}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Today button ─────────────────────────────────────────────── */}
        {selectedDate !== today && (
          <TouchableOpacity
            style={styles.todayBtn}
            onPress={() => {
              setSelectedDate(today);
              setDisplayMonth(today.slice(0, 7) + '-01');
            }}
          >
            <Text style={styles.todayBtnText}>{t('calendar.today')}</Text>
          </TouchableOpacity>
        )}

        {/* ── Day heading ───────────────────────────────────────────────── */}
        <View style={styles.agendaHeader}>
          <Text style={styles.agendaHeading}>
            {formatCivilDate(selectedDate, locale)}
          </Text>
          <View style={styles.addBtns}>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={onAddAppointment}
            >
              <Text style={styles.addBtnText}>{t('calendar.addAppointment')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addBtn, styles.addBtnSecondary]}
              onPress={onAddReminder}
            >
              <Text style={[styles.addBtnText, styles.addBtnTextSecondary]}>
                {t('calendar.addReminder')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Agenda list ──────────────────────────────────────────────── */}
        {selectedItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('calendar.empty')}</Text>
          </View>
        ) : (
          selectedItems.map((item, idx) => {
            if (item.kind === 'checklist') {
              return (
                <TouchableOpacity
                  key={item.item.id + idx}
                  style={styles.agendaItem}
                  onPress={() => onEditAppointment?.(item.item.id)}
                >
                  <View style={[styles.agendaDot, styles.dotSage]} />
                  <View style={styles.agendaContent}>
                    <Text style={styles.agendaTitle}>{item.item.title}</Text>
                    {item.item.scheduledAt && (
                      <Text style={styles.agendaTime}>
                        {item.item.scheduledAt.slice(11, 16)}
                      </Text>
                    )}
                    {item.item.done && (
                      <Text style={styles.agendaStatus}>{t('calendar.status.done')}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }

            // occurrence
            const statusColor =
              item.status === 'done'
                ? styles.dotSage
                : item.status === 'missed'
                ? styles.dotRose
                : styles.dotTeal;

            return (
              <TouchableOpacity
                key={item.id + idx}
                style={styles.agendaItem}
                onPress={() => {
                  if (item.status !== 'done') {
                    handleOccurrenceAction(
                      item.id,
                      item.reminderId,
                      item.scheduledLocalTime,
                      item.displayTitle,
                      item.status,
                    );
                  }
                }}
              >
                <View style={[styles.agendaDot, statusColor]} />
                <View style={styles.agendaContent}>
                  <Text style={styles.agendaTitle}>{item.displayTitle}</Text>
                  <Text style={styles.agendaTime}>
                    {item.scheduledLocalTime.slice(11, 16)}
                  </Text>
                  <Text style={styles.agendaStatus}>
                    {occurrenceStatusLabel(item.status, t)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CELL_SIZE = 44;
const DOT_SIZE = 6;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FBF6F1' },

  // Sync banners
  syncBar: {
    backgroundColor: '#EBF2EC',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  syncBarText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#4A7A56',
  },
  errorBar: {
    backgroundColor: '#FBEDEE',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  errorBarText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#8E3A44',
  },

  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  monthArrow: { padding: 8 },
  monthArrowText: { fontSize: 24, color: '#3A2A30' },
  monthLabel: { fontSize: 17, fontWeight: '600', color: '#3A2A30' },

  dowRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  dowLabel: {
    width: `${100 / 7}%` as unknown as number,
    textAlign: 'center',
    fontSize: 12,
    color: '#94818A',
    paddingBottom: 4,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 4,
  },
  dayCell: {
    width: `${100 / 7}%` as unknown as number,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  dayCellToday: {
    borderRadius: 22,
    backgroundColor: '#FBEDEE',
  },
  dayCellSelected: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#A8505A',
  },
  dayNumber: { fontSize: 14, color: '#3A2A30' },
  dayNumberToday: { color: '#A8505A', fontWeight: '700' },
  dayNumberSelected: { fontWeight: '700' },

  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginTop: 2,
  },
  dotRose: { backgroundColor: '#A8505A' },
  dotTeal: { backgroundColor: '#3B8C8C' },
  dotSage: { backgroundColor: '#4A7A56' },

  todayBtn: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F4D9DC',
  },
  todayBtnText: { fontSize: 13, color: '#A8505A', fontWeight: '600' },

  agendaHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#EBE1D9',
  },
  agendaHeading: { fontSize: 15, fontWeight: '600', color: '#3A2A30' },
  addBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  addBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#A8505A',
  },
  addBtnSecondary: { backgroundColor: '#3B8C8C' },
  addBtnText: { fontSize: 12, color: '#FFFFFF', fontWeight: '600' },
  addBtnTextSecondary: { color: '#FFFFFF' },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: { fontSize: 14, color: '#94818A' },

  agendaItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE1D9',
    alignItems: 'flex-start',
  },
  agendaDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    marginRight: 12,
    flexShrink: 0,
  },
  agendaContent: { flex: 1 },
  agendaTitle: { fontSize: 15, color: '#3A2A30', fontWeight: '500' },
  agendaTime: { fontSize: 13, color: '#5F4A52', marginTop: 2 },
  agendaStatus: { fontSize: 12, color: '#94818A', marginTop: 2 },
});
