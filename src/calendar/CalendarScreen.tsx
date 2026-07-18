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
 * Design tokens: see src/theme/tokens.ts (T.*) — this screen consumes semantic
 * tokens only (T.color.state.*, T.color.list.bar.*, T.type.*).
 *
 * Security: no health data logged.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
import { formatCivilDate, formatYearMonth, interpolate, WEEKDAYS } from '../i18n/messages';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { getKickCountSessionsForDate } from './kickCountAgenda';
import { feedingSessionStore } from '../autoStockDecrement/feedingSessionStore';
import { getFeedingSessionsForDate } from './feedingAgenda';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { createCalendarSyncClient } from '../sync/syncClient';
import { executePush } from '../sync/pushOrchestrator';
import { expand } from '../recurrence/recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import { bucketCivilDay } from './civilDayBucketer';
import type { TokenStorage } from '../auth/tokenStorage';
import type { Locale } from '../auth/types';
import type { ChecklistItemRecord, ReminderOccurrenceRecord, OccurrenceStatus, ReminderType, MedicationLogInput } from '../sync/syncTypes';
import { T } from '../theme/tokens';
import type { Lifecycle } from '../pregnancy/types';
import { PandanEmptyState } from '../illustrations/PandanEmptyState';
import { consumePendingCalendarFocusDate } from './pendingCalendarFocusDate';
import { reanchor, cancelForOccurrence, scheduleSnooze, MEDICATION_TITLE_TH } from '../notifications';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
import { resolveMedicationOccurrenceTitle } from './medicationOccurrenceResolver';
import type { MedicationPlan } from '../sync/syncTypes';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';
import { executeMarkDoneHandler } from './markDoneLogic';
import { consentStore } from '../consent/consentStore';
import { createConsentApiClient } from '../consent/consentApiClient';
import { consentQueue } from '../consent/consentSync';
import { commitCareActivityDecrement } from '../autoStockDecrement/decrementCommit';
import { consumptionMappingStore } from '../autoStockDecrement/consumptionMappingStore';
import { supplySyncStore } from '../sync/supplySyncStore';
import { stockDecrementMarkerStore } from '../autoStockDecrement/stockDecrementMarkerStore';
import { ConsentNudgeModal } from '../consent/ConsentNudgeModal';
import { SnoozeChooserSheet } from './SnoozeChooserSheet';
import {
  isMedicationReminder,
  computeSnoozedUntil,
  type SnoozeDuration,
} from './snoozeChooserLogic';

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
      /**
       * In-app display title.
       * For medication occurrences: the decoded drug name resolved from the
       * linked medication_plan (SD-11 in-app half — design §5.3 / ADR Decision 4).
       * For all other types: the reminder's displayTitle verbatim.
       * NEVER used as a notification payload (that uses MEDICATION_TITLE_TH).
       */
      displayTitle: string;
      /**
       * Decoded dose string for medication occurrences (e.g. "1 เม็ด").
       * Null for non-medication occurrences or when the plan has no dose.
       * Security: MOTHER-health SD-2 — never log this field.
       */
      dose: string | null;
      status: OccurrenceStatus;
      materialized: boolean;
      /**
       * Parent Reminder.type — used by handleOccurrenceAction to branch on
       * the mark-done side-effect (medication → create MedicationLog; others → zero logs).
       * Spec §3.5 / AC-17b.
       */
      reminderType: ReminderType;
      /**
       * reminder.sourceRefId — the medication plan UUID for medication occurrences.
       * Undefined for reminder types that have no sourceRef (custom, kick_count, etc.).
       * Security: MOTHER-health SD-2 — never log this field.
       */
      sourceRefId: string | undefined;
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

/**
 * Format a "YYYY-MM-DDTHH:mm" floating-civil occurrence time for human display
 * (e.g. Alert body). Locale-aware date portion (พ.ศ. for th) via formatCivilDate;
 * time portion is locale-independent "HH:mm" (24h, unambiguous).
 * 🔴 fix: previously the RAW ISO string was shown verbatim in the mark-done Alert.
 */
function formatOccurrenceDateTime(scheduledLocalTime: string, locale: Locale): string {
  const civilDate = scheduledLocalTime.slice(0, 10);
  const time = scheduledLocalTime.slice(11, 16);
  return `${formatCivilDate(civilDate, locale)} · ${time}`;
}

// ─── Projection logic ─────────────────────────────────────────────────────────

/**
 * Project all reminder occurrences in [today, today+PROJECTION_DAYS].
 * Returns a map of civil-date → projected occurrence items.
 * Merged with materialized (done/snoozed) rows via dedup (materialized wins).
 *
 * @param today     Civil "YYYY-MM-DD" for today's date (device local).
 * @param plansById Map<planId, MedicationPlan> for in-app medication name
 *                  resolution (SD-11 in-app half — design §5.3 / ADR Decision 4).
 *                  Passed explicitly so this function stays unit-testable.
 */
function buildProjectedItems(
  today: string,
  plansById: ReadonlyMap<string, MedicationPlan>,
): Map<string, CalendarItem[]> {
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

    // Resolve in-app display title + dose for this reminder (SD-11 in-app half).
    // For medication reminders: decodes drug name/dose from the linked plan.
    // For other types: returns displayTitle verbatim.
    // Security: the resolved `title` is for in-app display ONLY — never for
    // notification payloads (those use MEDICATION_TITLE_TH via notificationScheduler).
    const { title: resolvedTitle, dose: resolvedDose } =
      resolveMedicationOccurrenceTitle(reminder, plansById);

    // Build projected items, then dedup with materialized
    interface RawOcc {
      id: string;
      reminderId: string;
      scheduledLocalTime: string;
      displayTitle: string;
      dose: string | null;
      status: OccurrenceStatus;
      materialized: boolean;
      reminderType: ReminderType;
      sourceRefId: string | undefined;
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
        displayTitle: resolvedTitle,
        dose: resolvedDose,
        status: materialized
          ? materialized.status
          : isPastDate
          ? 'missed'
          : 'due',
        materialized: !!materialized,
        // Task 4: carry reminder type + sourceRefId so handleOccurrenceAction can
        // branch on mark-done side-effect (medication → MedicationLog; others → zero).
        // Spec §3.5 / AC-17b.
        reminderType: reminder.type,
        sourceRefId: reminder.sourceRefId,
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
          displayTitle: resolvedTitle,
          dose: resolvedDose,
          status: mat.status,
          materialized: true,
          reminderType: reminder.type,
          sourceRefId: reminder.sourceRefId,
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

/**
 * Feeding-session kind label (bug fix — feeding log now appears on the
 * calendar). FW-1: neutral copy only via i18n keys, no brand/product names.
 */
function feedingKindLabel(
  kind: 'breastfeed' | 'pump' | 'formula',
  t: (key: MessageKey) => string,
): string {
  const keyMap: Record<'breastfeed' | 'pump' | 'formula', MessageKey> = {
    breastfeed: 'calendar.feeding.breastfeed',
    pump: 'calendar.feeding.pump',
    formula: 'calendar.feeding.formula',
  };
  return t(keyMap[kind]);
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

// ─── Loss-state gate (B2 — ห้องแม่ Phase 2) ─────────────────────────────────

/**
 * Filters CalendarItems to suppress pregnancy-progress content when lifecycle='ended'.
 *
 * Rules (spec §3 / B2 Loss-State Gate Registry):
 *   - lifecycle='ended' (loss/bereavement state): suppress kick_count occurrences.
 *     Kick counting is a pregnancy-progress activity with no meaning after loss.
 *   - lifecycle=undefined (snapshot unavailable): MUST NOT suppress — not a loss state (GAP-2).
 *   - lifecycle='pregnant'|'postpartum': retain all items.
 *   - Checklist items (appointments) are ALWAYS retained.
 *
 * NOTE: 'milestone' and 'countdown' ReminderTypes are not yet in the ReminderType union.
 * When added (future slice), add them here too.
 *
 * Exported as a pure function for unit-testable TDD loss-gate tests.
 */
export function filterLossStateItems(
  items: CalendarItem[],
  lifecycle?: Lifecycle,
): CalendarItem[] {
  if (lifecycle !== 'ended') return items;
  return items.filter((item) => {
    if (item.kind === 'checklist') return true; // appointments always shown
    return item.reminderType !== 'kick_count';
  });
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
  /**
   * Called when the user taps the Day-Detail "Add / บันทึกสุขภาพ" affordance.
   * Receives the currently selected civil date (YYYY-MM-DD) so the Capture
   * screen can default its date field to the day being viewed.
   * Spec: capture-ui.md §2, calendar-home-screens §4.4.
   */
  onAddCapture?: (loggedAtDate: string) => void;
  /**
   * ห้องแม่ B2 loss-state gate: lifecycle='ended' → suppress kick_count occurrences.
   * Undefined = unknown/not loaded; must NEVER suppress items (GAP-2).
   */
  lifecycle?: Lifecycle;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CalendarScreen({
  tokenStorage,
  apiBaseUrl,
  onAddAppointment,
  onEditAppointment,
  onAddReminder,
  onEditReminder,
  onAddCapture,
  lifecycle,
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

  // Task 4 (AC-17 / MR-E1): held medication log for the consent-gate path.
  // When executeMarkDoneHandler returns showNudge=true (general_health absent),
  // the occurrence is already done but the taken log must NOT be written yet.
  // heldMedicationLogRef stores the held payload + deterministic id so the grant
  // handler can flush it via medicationLogSyncStore.addLog(payload, logId).
  // Same-session lifetime: cleared on both grant AND not-now dismiss (matching
  // CaptureScreen's shipped posture — §B.4 / MR-E1).
  // Security: NEVER log this ref's contents (SD-5 MOTHER-health).
  const heldMedicationLogRef = useRef<{
    payload: MedicationLogInput;
    logId: string;
  } | null>(null);

  // Consent modal state — shown when executeMarkDoneHandler returns showNudge=true.
  // Mirrors CaptureScreen's showConsentModal / consentLoading pattern (§B.4).
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);

  // Task 5: snooze chooser state (medication-only 10/30/60 picker — spec §2)
  const [showSnoozeChooser, setShowSnoozeChooser] = useState(false);
  // pendingSnoozeRef stores the occurrence context while the chooser sheet is open.
  // Using a ref (not state) avoids an extra render on open; cleared on pick/dismiss.
  // Minor 3: openedAt is snapshotted when the chooser opens (not re-evaluated on
  // every parent render) so the "alerts at" times in the sheet are stable and
  // handleSnooze uses the same baseline as the displayed times.
  const pendingSnoozeRef = useRef<{
    id: string;
    reminderId: string;
    scheduledLocalTime: string;
    displayTitle: string;
    /** Snapshot of new Date() taken when the chooser was opened (Minor 3). */
    openedAt: Date;
  } | null>(null);

  // Refresh display maps from store (triggers useMemo re-run via refreshKey)
  const refreshFromStore = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Re-read the store whenever the screen regains focus — e.g. returning from
  // AppointmentForm/ReminderForm after a save. Without this, a native-stack
  // goBack() does not remount CalendarScreen, so a just-created item would not
  // appear until the next foreground/pull.
  //
  // Also consume any pending focus date set by the form screen on save so the
  // agenda auto-scrolls to the new item's date instead of staying on today.
  useFocusEffect(
    useCallback(() => {
      refreshFromStore();

      const focusDate = consumePendingCalendarFocusDate();
      if (focusDate) {
        setSelectedDate(focusDate);
        setDisplayMonth(focusDate.slice(0, 7) + '-01');
      }
    }, [refreshFromStore]),
  );

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

  // ── Pull + push (sync all) ─────────────────────────────────────────────────
  // Pull first to hydrate store, then push any pending mutations.
  // syncPush is a no-op when getPendingCount() === 0, so safe to always call.

  const syncAll = useCallback(async () => {
    await syncPull();
    await syncPush();
  }, [syncPull, syncPush]);

  // ── Notification re-anchor (FLAG-5, ADR Decision 2) ───────────────────────
  // Re-materializes the rolling-window OS notification schedule after sync.
  // Calls reanchor() from src/notifications/index.ts which:
  //   1. Builds the new 7-day window from active reminders
  //   2. Cancels stale pending OS notifications
  //   3. Schedules the new set (idempotent replace via deterministic occurrence id)
  // Permission-declined is non-fatal: calendar projection unaffected.
  // Device-only (expo-notifications native module); not exercised in CI unit tests.
  const reanchorNotifications = useCallback(async () => {
    const reminders = calendarSyncStore.getActiveReminders();
    // Collect all materialized occurrences across all active reminders
    const occurrences = reminders.flatMap((r) =>
      calendarSyncStore.getOccurrencesForReminder(r.id),
    );
    // Non-fatal: any native error is swallowed inside reanchor()
    await reanchor(reminders, occurrences);
  }, []);

  // ── Sync + re-anchor (combined foreground flow) ────────────────────────────

  const syncAndReanchor = useCallback(async () => {
    await syncAll();
    // Re-anchor after sync so we have fresh reminder data from the server
    void reanchorNotifications();
  }, [syncAll, reanchorNotifications]);

  // ── Pull on mount and foreground ───────────────────────────────────────────

  useEffect(() => {
    void syncAndReanchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleAppState(next: AppStateStatus): void {
      if (next === 'active') {
        void syncAndReanchor();
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [syncAndReanchor]);

  // ── Build calendar maps ────────────────────────────────────────────────────

  // refreshKey in deps triggers rebuild after pull or occurrence action
  const { checklistMap, occurrenceMap } = useMemo(() => {
    const c = buildChecklistItems();
    // Build plansById from the medication plan store for in-app name resolution.
    // SD-11 in-app half (ADR Decision 4 / design §5.3): medication occurrence rows
    // display the real drug name from the linked plan, not the generic displayTitle.
    const plansById = new Map<string, MedicationPlan>(
      medicationPlanSyncStore.getPlans().map((p) => [p.id, p]),
    );
    const o = buildProjectedItems(today, plansById);
    return { checklistMap: c, occurrenceMap: o };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, refreshKey]);

  const getItemsForDate = useCallback(
    (date: string): CalendarItem[] => {
      const checklist = checklistMap.get(date) ?? [];
      const occurrences = occurrenceMap.get(date) ?? [];
      const raw = [...checklist, ...occurrences].sort((a, b) => {
        const ta = a.kind === 'checklist' ? (a.item.scheduledAt ?? '') : a.scheduledLocalTime;
        const tb = b.kind === 'checklist' ? (b.item.scheduledAt ?? '') : b.scheduledLocalTime;
        return ta.localeCompare(tb);
      });
      // B2 loss-state gate: suppress pregnancy-progress items when lifecycle='ended'.
      return filterLossStateItems(raw, lifecycle);
    },
    [checklistMap, occurrenceMap, lifecycle],
  );

  const selectedItems = getItemsForDate(selectedDate);

  // Kick-count sessions for the selected day.
  // refreshKey keeps this in sync with the calendar store refresh cycle
  // (same pattern as checklistMap / occurrenceMap above).
  // Security (K-8): NEVER log movementCount or any session field.
  //
  // B2 loss-state gate: suppress kick-count session rows when lifecycle='ended'
  // (HomeTabScreen §863 hides the kick-count module in loss state — calendar must
  // be consistent). GAP-2: undefined lifecycle must NOT suppress (not a loss state).
  const kickCountItems = useMemo(
    () => lifecycle === 'ended'
      ? []
      : getKickCountSessionsForDate(
          kickCountSyncStore.getActiveSessions(),
          selectedDate,
          bucketCivilDay,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDate, refreshKey, lifecycle],
  );

  // Feeding sessions for the selected day.
  // Bug fix (owner report "บันทึกการให้นมไม่ขึ้นในปฏิทิน"): feedingSessionStore
  // was written to by FeedingLogScreen but never read anywhere else — the
  // calendar had no concept of feeding sessions at all. Wired here exactly
  // like kickCountItems above (same refreshKey/focus-refresh mechanism, same
  // civil-date bucketing, same lifecycle='ended' loss-state suppression).
  // Security (K-8): NEVER log amountSubUnits/volumeMl/durationSeconds/note.
  const feedingItems = useMemo(
    () => lifecycle === 'ended'
      ? []
      : getFeedingSessionsForDate(
          feedingSessionStore.getAll(),
          selectedDate,
          bucketCivilDay,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDate, refreshKey, lifecycle],
  );

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

  // ── Consent grant handler (mark-done gate path) ───────────────────────────
  // Mirrors CaptureScreen's handleConsentGrant (§B.4):
  //   1. Optimistic store update (consentStore.setGranted).
  //   2. POST consent; queue for retry on failure.
  //   3. In finally: flush held medication log using deterministic markDoneLogId
  //      (dedup guard — same id from any device → server union-merge, D3/E7).
  // Security: NEVER log heldMedicationLogRef contents (SD-5 MOTHER-health).
  const handleMarkDoneConsentGrant = useCallback((): void => {
    const version = (locale as Locale) === 'en' ? 'v1.0-en' : 'v1.0-th';
    consentStore.setGranted('general_health', true, version);
    setConsentLoading(true);

    void (async () => {
      try {
        const tokens = await tokenStorage.load();
        if (!tokens) throw new Error('no_tokens');
        const client = createConsentApiClient(apiBaseUrl);
        const result = await client.postConsent('general_health', true, version, tokens.accessToken);
        if (!result.ok) {
          if (!consentQueue.hasPendingEntry('general_health', true)) {
            consentQueue.enqueue('general_health', true, version);
            void consentQueue.persist();
          }
        }
      } catch {
        if (!consentQueue.hasPendingEntry('general_health', true)) {
          consentQueue.enqueue('general_health', true, version);
          void consentQueue.persist();
        }
      } finally {
        setConsentLoading(false);
        setShowConsentModal(false);
        // Flush held taken-log with the deterministic id (dedup guard, spec §3.2).
        // addLog is idempotent for the same id — double-tap or double-grant is safe.
        // Security: NEVER log held contents (SD-5).
        const held = heldMedicationLogRef.current;
        heldMedicationLogRef.current = null;
        if (held) {
          try {
            medicationLogSyncStore.addLog(held.payload, held.logId);
          } catch {
            // Local write failure is non-fatal here; the payload is permanently lost
            // if we drop it — but this path requires the in-memory store to throw,
            // which it does not under normal operation.
          }
        }
      }
    })();
  }, [locale, tokenStorage, apiBaseUrl]);

  // ── Task 5: handle snooze chooser pick ────────────────────────────────────
  // Called when the user taps a 10/30/60-min option in SnoozeChooserSheet.
  // Applies the snooze: writes the occurrence, schedules the OS alarm, closes sheet.
  const handleSnooze = useCallback(
    (minutes: SnoozeDuration) => {
      const pending = pendingSnoozeRef.current;
      if (!pending) return;

      // Minor 3: use the snapshotted openedAt so snoozedUntil matches the
      // "alerts at" times displayed in the sheet (stable across parent renders).
      const now = pending.openedAt;
      const snoozedUntilDate = computeSnoozedUntil(minutes, now);
      const snoozedUntilStr = snoozedUntilDate.toISOString();

      // 1. Write snoozed occurrence optimistically (same path as existing snooze)
      calendarSyncStore.enqueueOccurrence(
        pending.reminderId,
        pending.scheduledLocalTime,
        'snoozed',
        now.toISOString(),
        snoozedUntilStr,
      );
      refreshFromStore();
      void syncPush();

      // 2. Schedule exactly ONE new OS alarm at snoozedUntil (Task 5 reschedule).
      //    Same-id scheduling replaces any prior pending alarm (idempotent replace —
      //    MR-E11 / INV-MR-5 / ADR Decision 2). No pre-cancel needed: the pre-cancel
      //    was a race — if cancelAsync resolved AFTER scheduleAsync, it silenced the
      //    newly created alarm. Rely on same-id replace exclusively (Fix C).
      //    SD-11: medication title is the generic constant — never the drug name.
      void scheduleSnooze(pending.id, snoozedUntilDate, MEDICATION_TITLE_TH);

      // Close the chooser
      pendingSnoozeRef.current = null;
      setShowSnoozeChooser(false);
    },
    [refreshFromStore, syncPush],
  );

  // Mark done / snooze / edit for a reminder occurrence (FLAG-7/W-A + Feature B)
  const handleOccurrenceAction = useCallback(
    (
      id: string,
      reminderId: string,
      scheduledLocalTime: string,
      displayTitle: string,
      currentStatus: OccurrenceStatus,
      reminderType: ReminderType,
      sourceRefId: string | undefined,
    ) => {
      if (currentStatus === 'done') return;

      Alert.alert(
        displayTitle,
        // 🔴 fix: was the RAW ISO string ("2026-07-15T08:00"); now locale-aware
        // (พ.ศ. for th) via formatOccurrenceDateTime.
        formatOccurrenceDateTime(scheduledLocalTime, locale as Locale),
        [
          {
            text: t('calendar.markDone'),
            onPress: () => {
              // 1. Flip occurrence → done (optimistic, always — even if consent absent).
              //    ReminderOccurrence is cloud_storage gated, not general_health (E10).
              calendarSyncStore.enqueueOccurrence(
                reminderId,
                scheduledLocalTime,
                'done',
                new Date().toISOString(),
              );
              refreshFromStore();
              // Push immediately — fire-and-forget (no await to not block UI)
              void syncPush();
              // Cancel the OS notification for this occurrence (spec §3.4).
              // `id` is the deterministic uuidv5 occurrence id — used as the OS notification
              // identifier (ADR Decision 2 / functional spec §3.4).
              void cancelForOccurrence(id);

              // T-D: fire care-activity decrement trigger (auto-stock-decrement §3).
              // D-1: this is a local user action — isPulled=false.
              // M2: read careActivityType LIVE from the Reminder at done-commit time
              //     (NOT from a cached/snapshot value captured at occurrence creation).
              // Swallowed on any failure per E-3 (best-effort, never blocks the UI).
              // NEVER log occurrenceId, careActivityType, or draw results (K-8/SD-5).
              const _liveReminder = calendarSyncStore.getReminder(reminderId);
              const _careActivityType = _liveReminder?.careActivityType ?? null;
              commitCareActivityDecrement({
                occurrenceId: id, // deterministic uuidv5 (reminderId, scheduledLocalTime)
                careActivityType: _careActivityType,
                consentGeneralHealth: consentStore.isGranted('general_health'),
                supplyStore: supplySyncStore,
                consumptionMappingStore,
                markerStore: stockDecrementMarkerStore,
                isPulled: false,
              });

              // 2. For medication occurrences only: create exactly ONE taken log via
              //    executeMarkDoneHandler (spec §3.1 / AC-17b / MR-E1).
              //    Non-medication → AC-17b: zero logs.
              //    Consent absent → showNudge=true: show JIT nudge, hold payload.
              //    Consent present → addLog called internally with deterministic id.
              const handlerResult = executeMarkDoneHandler({
                reminderType,
                sourceRefId,
                oid: id,
                scheduledLocalTime,
                consentGranted: consentStore.isGranted('general_health'),
                addLog: (payload, logId) => {
                  // Security: NEVER log payload contents (SD-5 MOTHER-health).
                  medicationLogSyncStore.addLog(payload, logId);
                },
              });

              if (handlerResult.showNudge) {
                // Consent absent (MR-E1): occurrence is already done (step 1 above).
                // Hold the payload + deterministic id; show JIT consent nudge.
                // Grant handler (handleMarkDoneConsentGrant) will flush on grant.
                // Not-now handler clears the ref (same-session lifetime — §B.4).
                // Security: NEVER log heldPayload contents (SD-5).
                heldMedicationLogRef.current = {
                  payload: handlerResult.heldPayload,
                  logId: handlerResult.heldLogId,
                };
                setShowConsentModal(true);
              }
            },
          },
          // Task 5 snooze routing (spec §2.1):
          //   - medication → show 10/30/60 chooser (SnoozeChooserSheet); re-snooze allowed
          //   - non-medication → fixed 1h, no chooser; not offered when already snoozed
          ...(isMedicationReminder(reminderType) || currentStatus !== 'snoozed'
            ? [
                {
                  // Medication: "เลื่อนเตือน" (chooser opens); non-medication: "เลื่อน 1 ชั่วโมง"
                  text: isMedicationReminder(reminderType)
                    ? t('notification.action.snooze')
                    : t('calendar.snooze1h'),
                  onPress: () => {
                    if (isMedicationReminder(reminderType)) {
                      // Medication: open the 10/30/60 chooser sheet.
                      // Store context in ref so handleSnooze can apply the pick.
                      // Minor 3: snapshot now at open time so the displayed "alerts at"
                      // times are stable across parent re-renders and handleSnooze uses
                      // the same baseline as the times shown to the user.
                      pendingSnoozeRef.current = {
                        id,
                        reminderId,
                        scheduledLocalTime,
                        displayTitle,
                        openedAt: new Date(),
                      };
                      setShowSnoozeChooser(true);
                    } else {
                      // Non-medication: apply fixed now + 60 min (spec §2.3).
                      // Task 5: NOW also schedules the OS alarm at snoozedUntil
                      // (Task-2 deferred this; the "reschedule is deferred to Task 5"
                      // comment is now resolved — Task 5 is here).
                      const now = new Date();
                      const snoozedUntilDate = new Date(now.getTime() + 60 * 60 * 1000);
                      const snoozedUntilStr = snoozedUntilDate.toISOString();
                      calendarSyncStore.enqueueOccurrence(
                        reminderId,
                        scheduledLocalTime,
                        'snoozed',
                        now.toISOString(),
                        snoozedUntilStr,
                      );
                      refreshFromStore();
                      void syncPush();
                      // Schedule at snoozedUntil via same-id replace (idempotent —
                      // MR-E11 / INV-MR-5 / ADR Decision 2). No pre-cancel: the
                      // pre-cancel was a race that could silence the new alarm (Fix C).
                      void scheduleSnooze(id, snoozedUntilDate, displayTitle);
                    }
                  },
                },
              ]
            : []),
          // Feature B (#13): "แก้ไข" option → opens ReminderFormScreen in edit mode.
          // onEditReminder is declared + wired in RootNavigator; was never called
          // from this Alert until now.
          {
            text: t('calendar.editReminder'),
            onPress: () => {
              onEditReminder?.(reminderId);
            },
          },
          { text: t('general.cancel'), style: 'cancel' },
        ],
      );
    },
    [t, locale, refreshFromStore, syncPush, onEditReminder, handleMarkDoneConsentGrant, setShowSnoozeChooser],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const [displayY, displayM] = displayMonth.split('-').map(Number);
  const monthLabel = formatYearMonth(displayMonth.slice(0, 7), locale);

  return (
    <SafeAreaView testID="calendar-screen" style={styles.container}>
      {/* Sync status banners */}
      {syncing && (
        <View style={styles.syncBar}>
          <Text style={styles.syncBarText}>{t('calendar.loading')}</Text>
        </View>
      )}
      {syncError && (
        <TouchableOpacity
          style={styles.errorBar}
          onPress={() => void syncAll()}
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
          {WEEKDAYS[locale].map((d) => (
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
                    testID={dot === 'rose' ? 'calendar-day-dot-missed' : undefined}
                    style={[
                      styles.dot,
                      dot === 'rose' && styles.dotMissedRing,
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
              testID="calendar-add-appointment-btn"
              style={styles.addBtn}
              onPress={onAddAppointment}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.addAppointment.a11yLabel')}
            >
              <Text style={styles.addBtnText}>{t('calendar.addAppointment')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="calendar-add-reminder-btn"
              style={[styles.addBtn, styles.addBtnSecondary]}
              onPress={onAddReminder}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.addReminder.a11yLabel')}
            >
              <Text style={[styles.addBtnText, styles.addBtnTextSecondary]}>
                {t('calendar.addReminder')}
              </Text>
            </TouchableOpacity>
            {/* Day-Detail "Add / บันทึกสุขภาพ" — self-log capture entry point.
                Spec: capture-ui.md §2 (generic Add, type control shown),
                calendar-home-screens §4.4 (civil-day hand-off, no tz conversion).
                testID matches Maestro flow 11-capture-self-log-happy.yaml. */}
            <TouchableOpacity
              testID="calendar-add-capture-btn"
              style={[styles.addBtn, styles.addBtnCapture]}
              onPress={() => onAddCapture?.(selectedDate)}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.addCapture.a11yLabel')}
            >
              <Text style={[styles.addBtnText, styles.addBtnTextCapture]}>
                {t('calendar.addCapture')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Agenda list ──────────────────────────────────────────────── */}
        {selectedItems.length === 0 && kickCountItems.length === 0 && feedingItems.length === 0 ? (
          <View style={styles.emptyState}>
            <PandanEmptyState />
            <Text style={styles.emptyText}>{t('calendar.empty')}</Text>
          </View>
        ) : (
          selectedItems.map((item, idx) => {
            if (item.kind === 'checklist') {
              return (
                <TouchableOpacity
                  key={item.item.id + idx}
                  testID="calendar-agenda-item"
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
                testID="calendar-agenda-item"
                style={styles.agendaItem}
                onPress={() => {
                  if (item.status !== 'done') {
                    handleOccurrenceAction(
                      item.id,
                      item.reminderId,
                      item.scheduledLocalTime,
                      item.displayTitle,
                      item.status,
                      item.reminderType,
                      item.sourceRefId,
                    );
                  }
                }}
              >
                <View style={[styles.agendaDot, statusColor]} />
                <View style={styles.agendaContent}>
                  <Text style={styles.agendaTitle}>{item.displayTitle}</Text>
                  {/* Dose subtitle — shown only for medication occurrences with a
                      resolved dose (SD-11 in-app half: design §5.3 / ADR Decision 4).
                      Security: dose is MOTHER-health SD-2; never log this value. */}
                  {item.dose ? (
                    <Text style={styles.agendaDose}>{item.dose}</Text>
                  ) : null}
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

        {/* ── Kick-count rows ───────────────────────────────────────────
            Shown only when the selected day has ≥1 completed session.
            Display is read-only (no navigation — SD-9: no health in route params).
            Security (K-8): movementCount is displayed to the owner only; never logged.
            testID="calendar-kickcount-item" — used by Maestro / jest queries. */}
        {kickCountItems.map((kc) => (
          <View
            key={kc.id}
            testID="calendar-kickcount-item"
            style={styles.agendaItem}
            accessibilityLabel={interpolate(t('calendar.kickCount.label'), { count: kc.movementCount })}
          >
            <View style={[styles.agendaDot, styles.dotViolet]} />
            <View style={styles.agendaContent}>
              <Text style={styles.agendaTitle}>
                {interpolate(t('calendar.kickCount.label'), { count: kc.movementCount })}
              </Text>
              {kc.timeLabel.length > 0 && (
                <Text style={styles.agendaTime}>{kc.timeLabel}</Text>
              )}
            </View>
          </View>
        ))}

        {/* ── Feeding-session rows ───────────────────────────────────────
            Bug fix (owner report "บันทึกการให้นมไม่ขึ้นในปฏิทิน"): feeding
            sessions logged in FeedingLogScreen now appear here, on the day
            they were logged. Display is read-only (no navigation — SD-9:
            no health in route params).
            Security (K-8): never renders amountSubUnits/volumeMl/durationSeconds.
            testID="calendar-feeding-item" — used by Maestro / jest queries. */}
        {feedingItems.map((fs) => (
          <View
            key={fs.id}
            testID="calendar-feeding-item"
            style={styles.agendaItem}
            accessibilityLabel={feedingKindLabel(fs.kind, t)}
          >
            <View style={[styles.agendaDot, styles.dotJade]} />
            <View style={styles.agendaContent}>
              <Text style={styles.agendaTitle}>
                {feedingKindLabel(fs.kind, t)}
              </Text>
              {fs.timeLabel.length > 0 && (
                <Text style={styles.agendaTime}>{fs.timeLabel}</Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* JIT consent nudge — shown when mark-done is gated by absent general_health (MR-E1/AC-12).
          Reuses the shipped ConsentNudgeModal from the capture flow (same grant posture §B.4):
          Grant  → flush held medication log via handleMarkDoneConsentGrant + deterministic id.
          Not-now → clear held ref (same-session lifetime; data NOT permanently lost per spec).
          Security: heldMedicationLogRef contents are MOTHER-health — NEVER logged (SD-5). */}
      <ConsentNudgeModal
        testIDPrefix="calendar"
        visible={showConsentModal}
        isLoading={consentLoading}
        onGrant={handleMarkDoneConsentGrant}
        onNotNow={() => {
          // Clear held ref — user dismissed without granting (§B.4 same-session posture).
          // Matches CaptureScreen: pendingMedicationPayloadRef.current = null on not-now.
          // The occurrence is already done; the taken log will not be flushed this session.
          // If user later grants general_health (from Consent screen), no auto-retry occurs
          // in this MVP — this matches the shipped CaptureScreen posture exactly.
          heldMedicationLogRef.current = null;
          setShowConsentModal(false);
        }}
        title={t('capture.consent.title')}
        body={t('capture.consent.body')}
        grantLabel={t('capture.consent.grant')}
        notNowLabel={t('capture.consent.notNow')}
        changeLaterNote={t('capture.consent.changeLater')}
      />

      {/* Task 5: medication snooze chooser (10/30/60 min — spec §2 / screens-spec §2.1).
          Rendered only when visible=true (medication occurrence tapped Snooze).
          Non-medication occurrences skip this sheet entirely (fixed 1h path in handleOccurrenceAction).
          Dismiss without pick leaves the occurrence in its prior status — no write (spec §2.4). */}
      <SnoozeChooserSheet
        visible={showSnoozeChooser}
        now={pendingSnoozeRef.current?.openedAt ?? new Date()}
        onPick={handleSnooze}
        onDismiss={() => {
          // Dismissed without picking: no write; clear pending context.
          pendingSnoozeRef.current = null;
          setShowSnoozeChooser(false);
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// 🟡 fix: was 44 — below the ≥48dp touch-target minimum for the day cell.
const CELL_SIZE = 48;
const DOT_SIZE = 6;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.surface.base },

  // Sync banners — ห้องแม่ B2: caption (13sp) + text.primary (roselle-700)
  syncBar: {
    backgroundColor: T.offlinePill.bg,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  syncBarText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  errorBar: {
    backgroundColor: T.color.surface.wash.roselle,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  errorBarText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },

  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // 🟡 fix: was padding:8 (~40x40 with a 24sp glyph) — below ≥48dp touch target.
  monthArrow: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowText: { fontSize: 24, lineHeight: 24, color: T.color.text.heading },
  // 🟡 fix: added lineHeight (Thai stacked-mark rule §0 R2, ≥1.6× size).
  monthLabel: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: 17,
    lineHeight: 28,
    fontWeight: '600',
    color: T.color.text.heading,
  },

  dowRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  dowLabel: {
    width: `${100 / 7}%` as unknown as number,
    textAlign: 'center',
    fontSize: 12,
    color: T.color.text.primary,
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
    backgroundColor: T.color.surface.wash.roselle,
  },
  dayCellSelected: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: T.color.list.bar.pregnancy,
  },
  // 🟡 fix: added lineHeight (Thai stacked-mark rule §0 R2, ≥1.6× size).
  dayNumber: {
    fontFamily: T.type.body.fontFamily,
    fontSize: 14,
    lineHeight: 23,
    color: T.color.text.heading,
  },
  dayNumberToday: { color: T.color.text.primary, fontWeight: '700' },
  dayNumberSelected: { fontWeight: '700' },

  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginTop: 2,
  },
  // missed → amber-700 (state.attention — distinct from due; "shape as primary
  // cue" per tokens.ts comment). 🔴 fix: was aliased to the same token as `due`,
  // making missed (urgent, top precedence) visually indistinguishable from due.
  dotRose: { backgroundColor: T.color.state.attention },
  /**
   * Non-color cue for missed (🔴 fix): a visible ring around the dot so the
   * distinction does not rely on color alone (WCAG SC 1.4.1) — shape as
   * primary cue per tokens.ts `state.attention` comment. Ring is drawn OUTSIDE
   * the dot's own box (negative margin offsets the added border width) so the
   * dot's center position on the day cell is unchanged.
   */
  dotMissedRing: {
    width: DOT_SIZE + 4,
    height: DOT_SIZE + 4,
    borderRadius: (DOT_SIZE + 4) / 2,
    borderWidth: 1.5,
    borderColor: T.color.state.attention,
    margin: -2,
  },
  // due → roselle-500 (reminder colour)
  dotTeal: { backgroundColor: T.color.list.bar.pregnancy },
  // done / checklist → jade-600 (success state)
  dotSage: { backgroundColor: T.color.state.success },
  /**
   * Kick-count dot (distinct from rose/teal/sage). 🟡 fix: was inline hex
   * '#7B5EA7' (non-palette purple) — replaced with an in-palette token
   * (amber-600 / accent.milestone) per ห้องแม่ palette (roselle/amber/jade only).
   */
  dotViolet: { backgroundColor: T.color.accent.milestone },
  /**
   * Feeding-session dot (bug fix — feeding sessions now appear on the calendar).
   * jade-800 (accent.botanical) — distinct from dotSage (jade-600/success) while
   * staying in-palette (roselle/amber/jade only, no new hex).
   */
  dotJade: { backgroundColor: T.color.accent.botanical },

  todayBtn: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: T.color.surface.wash.roselle,
  },
  todayBtnText: { fontSize: 13, color: T.color.text.primary, fontWeight: '600' },

  agendaHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: T.color.surface.divider,
  },
  agendaHeading: { fontSize: 15, fontWeight: '600', color: T.color.text.heading },
  addBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  addBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 48,
    justifyContent: 'center' as const,
    borderRadius: T.radius.md,
    backgroundColor: T.color.accent.interactive,
  },
  addBtnSecondary: { backgroundColor: T.color.list.bar.health },
  /** Capture / self-log add button — jade-800 (health bar token). */
  addBtnCapture: { backgroundColor: T.color.list.bar.health },
  addBtnText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    color: T.color.text.onDark,
    fontWeight: '600',
  },
  addBtnTextSecondary: { color: T.color.text.onDark },
  addBtnTextCapture: { color: T.color.text.onDark },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
    marginTop: 12,
  },

  agendaItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
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
  // 🟡 fix: added lineHeight (Thai stacked-mark rule §0 R2, ≥1.6× size).
  agendaTitle: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    lineHeight: 24,
    color: T.color.text.heading,
    fontWeight: '500',
  },
  /** Dose subtitle for medication occurrences (design §5.2 / §5.3). */
  agendaDose: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    marginTop: 1,
  },
  agendaTime: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    marginTop: 2,
  },
  agendaStatus: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    color: T.color.text.primary,
    marginTop: 2,
  },
});
