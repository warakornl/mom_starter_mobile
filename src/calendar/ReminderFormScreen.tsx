/**
 * ReminderFormScreen — add or edit a Reminder with recurrenceRule.
 *
 * Client-side validation mirrors the server 422 for recurrenceRule (FLAG-4 grammar):
 *   - freq ∈ {one_off, daily, every_n_days}
 *   - timesOfDay: non-empty, distinct, sorted ascending, "HH:mm" format
 *     (required for daily/every_n_days; FORBIDDEN for one_off)
 *   - interval: required ≥ 1 iff freq=every_n_days; absent otherwise
 *   - until: valid "YYYY-MM-DD" if provided; optional
 *   - startAt: required "YYYY-MM-DDTHH:mm" (validated from date+time fields)
 *   - displayTitle: required, non-empty
 *
 * Write path (B1): mutations via calendarSyncStore → drainQueue() → sync/push.
 *
 * Notification firing (Task 2 — implemented):
 *   After save/delete, reanchor() from src/notifications/ re-materializes the
 *   rolling-window OS notification schedule (expo-notifications). Fire-and-forget;
 *   non-fatal. Exact-alarm behavior is a device-only launch-gate (Task 6).
 *
 * TODO carry-forward:
 *   - sourceRefType/sourceRefId for linking to ChecklistItem/SupplyItem
 *   - hideOnLockScreen toggle (SD-11)
 *
 * Security: displayTitle is NOT encrypted (ruling 3 / SD-11).
 *   Do NOT log displayTitle or any reminder field.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Switch,
  Modal,
  Platform,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { v4 as uuidv4 } from 'uuid';
import { useT } from '../i18n/LanguageContext';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { createCalendarSyncClient } from '../sync/syncClient';
import { executePush } from '../sync/pushOrchestrator';
import { localCivilToday } from '../pregnancy/gestationalAge';
import type { TokenStorage } from '../auth/tokenStorage';
import type { ReminderRecord, ReminderType, RecurrenceRuleWire, CareActivityType } from '../sync/syncTypes';
import { CareActivityTypeControl } from '../autoStockDecrement/CareActivityTypeControl';
import type { MessageKey } from '../i18n/messages';
import { formatCivilDate } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { toCivilDate, toCivilTime, parseCivilDate, parseCivilTime } from './dateTimePickerFormat';
import { setPendingCalendarFocusDate } from './pendingCalendarFocusDate';
import { reanchor } from '../notifications';
import { T } from '../theme/tokens';
import type { Lifecycle } from '../pregnancy/types';

// ─── FLAG-4 grammar validation — imported from pure-TS module (testable) ──────
//
// The validator + related types are defined in reminderFormValidator.ts (no React
// imports) so they can be unit-tested without a React Native environment.
// Re-exported here so existing callers that import from ReminderFormScreen.tsx
// continue to work without change.

import {
  validateRecurrenceRule,
  WEEKDAY_TOKENS,
  WEEKDAY_TOKEN_INDEX,
  type RuleValidationError,
} from './reminderFormValidator';

export type { RuleValidationError } from './reminderFormValidator';
export { validateRecurrenceRule, WEEKDAY_TOKENS, WEEKDAY_TOKEN_INDEX } from './reminderFormValidator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStartAt(date: string, time: string): string {
  return `${date}T${time}`;
}

const REMINDER_TYPES: ReminderType[] = [
  'custom', 'medication', 'appointment', 'kick_count', 'feeding', 'supply_restock',
];

/**
 * ห้องแม่ B2 milestone preset titles for pregnancy-progress reminders.
 * These chips pre-fill the reminder title field so the user can quickly set
 * common pregnancy milestone reminder names.
 *
 * NOTE: 'milestone' and 'countdown' ReminderTypes are not yet in the type union.
 * When added (future slice), add them to REMINDER_TYPES above.
 * These presets currently create reminders of the user's selected type (default: custom).
 */
const MILESTONE_PRESET_TITLES = ['เตือนสัปดาห์ที่ 28', 'เตือนนับถอยหลัง'];

// ─── Picker kind discriminator ────────────────────────────────────────────────

/**
 * Which picker is currently open.
 * 'startDate'  — the reminder start-date picker
 * 'startTime'  — the reminder start-time picker
 * 'until'      — the optional repeat-until date picker
 * 'tod-N'      — time-of-day picker for index N (stringified number suffix)
 */
type ActivePicker =
  | 'startDate'
  | 'startTime'
  | 'until'
  | `tod-${number}`
  | null;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReminderFormScreenProps {
  existingReminder?: ReminderRecord;
  /** Token storage — required to trigger sync push after save. */
  tokenStorage?: TokenStorage;
  /** API base URL — required to trigger sync push after save. */
  apiBaseUrl?: string;
  onSave?: () => void;
  onCancel?: () => void;
  /**
   * ห้องแม่ B2 loss-state gate: lifecycle='ended' → suppress milestone preset templates.
   * Undefined = unknown/not loaded; must NEVER suppress content (GAP-2).
   */
  lifecycle?: Lifecycle;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReminderFormScreen({
  existingReminder,
  tokenStorage,
  apiBaseUrl,
  onSave,
  onCancel,
  lifecycle,
}: ReminderFormScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const isEdit = !!existingReminder;

  // Parse existing startAt into date + time parts
  const existingStartDate = existingReminder?.startAt?.slice(0, 10) ?? localCivilToday();
  const existingStartTime = existingReminder?.startAt?.slice(11, 16) ?? '08:00';
  const existingRule = existingReminder?.recurrenceRule;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [displayTitle, setDisplayTitle] = useState(existingReminder?.displayTitle ?? '');
  const [type, setType] = useState<ReminderType>(existingReminder?.type ?? 'custom');
  const [startDate, setStartDate] = useState(existingStartDate);
  const [startTime, setStartTime] = useState(existingStartTime);
  const [freq, setFreq] = useState<'one_off' | 'daily' | 'every_n_days' | 'weekly'>(
    existingRule?.freq ?? 'one_off',
  );
  const [interval, setInterval] = useState(
    String(existingRule?.interval ?? 1),
  );
  const [timesOfDay, setTimesOfDay] = useState<string[]>(
    existingRule?.timesOfDay ?? ['08:00'],
  );
  const [until, setUntil] = useState(existingRule?.until ?? '');
  const [active, setActive] = useState(existingReminder?.active ?? true);
  /**
   * Selected weekday tokens for freq='weekly' (canonical MO<TU<WE<TH<FR<SA<SU order).
   * Pre-populated from existing rule's byDay when editing.
   */
  const [byDay, setByDay] = useState<string[]>(existingRule?.byDay ?? []);

  /**
   * careActivityType — tags this reminder as a care activity so that completing it
   * fires `applyCareActivityTrigger()` for auto-decrement.
   * US-AS6: null = not a care activity (no trigger, no marker).
   * INV-ASD-9/5: supply row carries ZERO activity linkage — this is health-side only.
   */
  const [careActivityType, setCareActivityType] = useState<CareActivityType | null>(
    existingReminder?.careActivityType ?? null,
  );

  const [errors, setErrors] = useState<RuleValidationError[]>([]);
  const [titleError, setTitleError] = useState('');

  // ── Picker state ───────────────────────────────────────────────────────────
  // Single "active picker" discriminator keeps state minimal.
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  // Temp Date for iOS while the wheel is spinning (committed on "Done").
  const [tempPickerValue, setTempPickerValue] = useState<Date>(new Date());

  // Derive whether a specific picker is visible
  const showStartDatePicker = activePicker === 'startDate';
  const showStartTimePicker = activePicker === 'startTime';
  const showUntilPicker = activePicker === 'until';
  const activeTodIdx: number | null = (() => {
    if (!activePicker || !activePicker.startsWith('tod-')) return null;
    return Number(activePicker.slice(4));
  })();

  // Calendar sync client — created once per mount (bound to calendarSyncStore)
  const clientRef = useRef(
    apiBaseUrl ? createCalendarSyncClient(apiBaseUrl, calendarSyncStore) : null,
  );

  /**
   * Trigger sync push fire-and-forget after a mutation.
   * Does nothing if tokenStorage / apiBaseUrl are not provided.
   */
  function triggerPush(): void {
    if (!tokenStorage || !clientRef.current) return;
    // Data is safe in the queue (🔴-A fix); .catch() prevents unhandled rejection
    // if tokenStorage.load() itself fails (e.g. storage I/O error).
    tokenStorage.load().then((tokens) => {
      if (tokens?.accessToken && clientRef.current) {
        void executePush(calendarSyncStore, clientRef.current, tokens.accessToken, uuidv4());
      }
    }).catch(() => {
      // Swallow — item stays in calendarSyncStore queue and will retry next push.
    });
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    let valid = true;
    if (!displayTitle.trim()) {
      setTitleError(t('reminder.errorTitleRequired'));
      valid = false;
    } else {
      setTitleError('');
    }

    const startAt = buildStartAt(startDate, startTime);
    // For one_off, the timesOfDay to validate against should be empty
    const todValidate = freq === 'one_off' ? [] : timesOfDay;
    const ruleErrors = validateRecurrenceRule(freq, interval, todValidate, until, startAt, byDay);
    setErrors(ruleErrors);
    if (ruleErrors.length > 0) valid = false;

    return valid;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  function handleSave() {
    if (!validate()) return;

    const startAt = buildStartAt(startDate, startTime);
    const now = new Date().toISOString();

    // Build recurrenceRule wire format
    const recurrenceRule: RecurrenceRuleWire = { freq };
    if (freq === 'every_n_days') {
      recurrenceRule.interval = Number(interval);
    }
    if (freq === 'weekly') {
      // interval optional for weekly (absent = 1); only include if user set it
      if (interval.trim() && interval.trim() !== '1') {
        recurrenceRule.interval = Number(interval.trim());
      }
      // byDay in canonical order (UI toggles maintain order; sort as safety net)
      recurrenceRule.byDay = [...byDay].sort(
        (a, b) => (WEEKDAY_TOKEN_INDEX[a] ?? 0) - (WEEKDAY_TOKEN_INDEX[b] ?? 0),
      ) as RecurrenceRuleWire['byDay'];
    }
    if (freq !== 'one_off' && timesOfDay.length > 0) {
      // Sort ascending (canonical form)
      recurrenceRule.timesOfDay = [...timesOfDay].sort();
    }
    if (until.trim()) {
      recurrenceRule.until = until.trim();
    }

    if (isEdit && existingReminder) {
      const updated: ReminderRecord = {
        ...existingReminder,
        displayTitle: displayTitle.trim(),
        type,
        recurrenceRule,
        startAt,
        active,
        // US-AS6: null = not a care activity (no T-D trigger). INV-ASD-9/5: supply row
        // carries ZERO activity linkage — careActivityType lives health-side only.
        careActivityType: careActivityType ?? null,
        updatedAt: now,
      };
      calendarSyncStore.enqueueUpdateReminder(updated);
    } else {
      const created: ReminderRecord = {
        id: uuidv4(),
        type,
        displayTitle: displayTitle.trim(),
        recurrenceRule,
        startAt,
        active,
        careActivityType: careActivityType ?? null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      calendarSyncStore.enqueueCreateReminder(created);
    }

    // Trigger notification re-anchor after save (replaces TODO carry-forward).
    // Fire-and-forget — non-fatal, never blocks navigation. Schedules the newly
    // saved reminder's occurrences within the 7-day rolling window.
    {
      const reminders = calendarSyncStore.getActiveReminders();
      const occurrences = reminders.flatMap((r) =>
        calendarSyncStore.getOccurrencesForReminder(r.id),
      );
      void reanchor(reminders, occurrences);
    }

    // Signal CalendarScreen to auto-select the reminder's start date on focus.
    // Must be set before onSave() / navigation.goBack() so useFocusEffect picks it up.
    setPendingCalendarFocusDate(startDate);

    // Navigate back first, then push (fire-and-forget — no await to not block UI)
    onSave?.();
    triggerPush();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  function handleDelete() {
    if (!existingReminder) return;
    Alert.alert(
      t('reminder.deleteConfirmTitle'),
      t('reminder.deleteConfirmMsg'),
      [
        { text: t('reminder.deleteConfirmCancel'), style: 'cancel' },
        {
          text: t('reminder.deleteConfirmOk'),
          style: 'destructive',
          onPress: () => {
            calendarSyncStore.enqueueDeleteReminder(existingReminder.id);
            // Re-anchor after delete — stale alarms for this reminder will be
            // cancelled by reanchor() because they are no longer in the active
            // reminder set (replaces TODO carry-forward: cancel OS alarms).
            {
              const reminders = calendarSyncStore.getActiveReminders();
              const occurrences = reminders.flatMap((r) =>
                calendarSyncStore.getOccurrencesForReminder(r.id),
              );
              void reanchor(reminders, occurrences);
            }
            onSave?.();
            triggerPush();
          },
        },
      ],
    );
  }

  // ── Add / remove times of day ───────────────────────────────────────────────
  function addTimeOfDay() {
    setTimesOfDay((prev) => [...prev, '08:00'].sort());
  }

  function updateTimeOfDay(idx: number, value: string) {
    setTimesOfDay((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next.sort();
    });
  }

  function removeTimeOfDay(idx: number) {
    setTimesOfDay((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Helper: first error for a field ────────────────────────────────────────
  function fieldError(field: RuleValidationError['field']): string {
    return errors.find((e) => e.field === field)?.message ?? '';
  }

  // ── Picker open helpers ────────────────────────────────────────────────────

  function openStartDatePicker() {
    setTempPickerValue(parseCivilDate(startDate));
    setActivePicker('startDate');
  }

  function openStartTimePicker() {
    setTempPickerValue(parseCivilTime(startTime));
    setActivePicker('startTime');
  }

  function openUntilPicker() {
    // If until is empty, default to today
    setTempPickerValue(parseCivilDate(until.trim() || localCivilToday()));
    setActivePicker('until');
  }

  function openTodPicker(idx: number) {
    setTempPickerValue(parseCivilTime(timesOfDay[idx] ?? '08:00'));
    setActivePicker(`tod-${idx}`);
  }

  // ── Generic picker change handlers ─────────────────────────────────────────

  /** Android: onChange fires once with the confirmed value; dismiss by setting activePicker=null. */
  function handlePickerChangeAndroid(_event: DateTimePickerEvent, selectedDate?: Date) {
    const kind = activePicker;
    setActivePicker(null);
    if (!selectedDate) return;

    if (kind === 'startDate') {
      setStartDate(toCivilDate(selectedDate));
    } else if (kind === 'startTime') {
      setStartTime(toCivilTime(selectedDate));
    } else if (kind === 'until') {
      setUntil(toCivilDate(selectedDate));
    } else if (kind !== null && kind.startsWith('tod-')) {
      const idx = Number(kind.slice(4));
      updateTimeOfDay(idx, toCivilTime(selectedDate));
    }
  }

  /** iOS: onChange fires continuously while spinning; commit on "Done". */
  function handlePickerChangeIOS(_event: DateTimePickerEvent, selectedDate?: Date) {
    if (selectedDate) setTempPickerValue(selectedDate);
  }

  function confirmPickerIOS() {
    const kind = activePicker;
    setActivePicker(null);

    if (kind === 'startDate') {
      setStartDate(toCivilDate(tempPickerValue));
    } else if (kind === 'startTime') {
      setStartTime(toCivilTime(tempPickerValue));
    } else if (kind === 'until') {
      setUntil(toCivilDate(tempPickerValue));
    } else if (kind !== null && kind.startsWith('tod-')) {
      const idx = Number(kind.slice(4));
      updateTimeOfDay(idx, toCivilTime(tempPickerValue));
    }
  }

  // Derive picker mode for the active kind
  const activePickerMode: 'date' | 'time' = (() => {
    if (activePicker === 'startDate' || activePicker === 'until') return 'date';
    return 'time';
  })();

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* Title */}
      <Text style={styles.label}>{t('reminder.fieldTitle')}</Text>
      <TextInput
        testID="reminder-title"
        style={[styles.input, titleError ? styles.inputError : null]}
        value={displayTitle}
        onChangeText={setDisplayTitle}
        placeholder={t('reminder.titlePlaceholder')}
        placeholderTextColor={T.input.placeholder}
        autoFocus={!isEdit}
      />
      {titleError ? <Text style={styles.errorText}>{titleError}</Text> : null}

      {/* Type picker (simplified tap list) */}
      <Text style={styles.label}>{t('reminder.fieldType')}</Text>
      <View style={styles.chipRow}>
        {REMINDER_TYPES.map((rt) => {
          const selected = type === rt;
          return (
            <TouchableOpacity
              key={rt}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setType(rt)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`reminder.type.${rt}` as MessageKey)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t(`reminder.type.${rt}` as MessageKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Care activity type control — tags the reminder for T-D auto-decrement trigger */}
      <CareActivityTypeControl
        value={careActivityType}
        onChange={setCareActivityType}
      />

      {/* ── Milestone preset templates (B2 ห้องแม่) ──────────────────────────
          Tapping a preset fills the title field with a template.
          Hidden when lifecycle='ended' (loss/bereavement — spec §3 B2 Loss-State Gate).
          Visible for 'pregnant', 'postpartum', and undefined (GAP-2: never default-suppress).

          NOTE: 'milestone' and 'countdown' ReminderTypes are not yet in the ReminderType union.
          Future slice: when added, change preset type to 'milestone'/'countdown'.
          Current behaviour: preset fills title only; type chip stays at user selection. */}
      {lifecycle !== 'ended' && (
        <View testID="reminder-milestone-presets" style={styles.presetSection}>
          <Text style={styles.label}>{t('reminder.milestonePresetsLabel')}</Text>
          <View style={styles.chipRow}>
            {MILESTONE_PRESET_TITLES.map((title) => (
              <TouchableOpacity
                key={title}
                style={styles.presetChip}
                onPress={() => setDisplayTitle(title)}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <Text style={styles.presetChipText}>{title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Start date — Pressable that opens DateTimePicker */}
      <Text style={styles.label}>{t('reminder.fieldStartDate')}</Text>
      <TouchableOpacity
        testID="reminder-startdate"
        style={[styles.pickerField, fieldError('startAt') ? styles.inputError : null]}
        onPress={openStartDatePicker}
        accessibilityRole="button"
        accessibilityLabel={`${t('reminder.fieldStartDate')}: ${formatCivilDate(startDate, locale as Locale)}`}
      >
        <Text style={styles.pickerFieldText}>
          {formatCivilDate(startDate, locale as Locale)}
        </Text>
        <Text style={styles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
      </TouchableOpacity>

      {/* Start time — Pressable that opens DateTimePicker */}
      <Text style={styles.label}>{t('reminder.fieldStartTime')}</Text>
      <TouchableOpacity
        testID="reminder-starttime"
        style={[styles.pickerField, fieldError('startAt') ? styles.inputError : null]}
        onPress={openStartTimePicker}
        accessibilityRole="button"
        accessibilityLabel={`${t('reminder.fieldStartTime')}: ${startTime}`}
      >
        <Text style={styles.pickerFieldText}>{startTime}</Text>
        <Text style={styles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
      </TouchableOpacity>

      {fieldError('startAt') ? (
        <Text style={styles.errorText}>{fieldError('startAt')}</Text>
      ) : null}

      {/* Freq — renamed "ทำซ้ำ" / "Repeat" per design. Includes weekly chip. */}
      <Text style={styles.label}>{t('reminder.fieldFreq')}</Text>
      <View style={styles.chipRow}>
        {(['one_off', 'daily', 'every_n_days', 'weekly'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            testID={`reminder-freq-${f}`}
            style={[styles.chip, freq === f && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: freq === f }}
            accessibilityLabel={t(`reminder.freq.${f}` as MessageKey)}
            onPress={() => {
              setFreq(f);
              // Clear byDay when switching away from weekly to avoid stale state
              if (f !== 'weekly') setByDay([]);
              // one_off/daily forbid interval — reset it so a stale weekly/
              // every_n_days interval can't silently block Save (validator error
              // with no visible interval field).
              if (f === 'one_off' || f === 'daily') setInterval('1');
              // one_off forbids until (server rejects it) — clear any set value
              // so the user can't inadvertently 422 by switching freq after
              // having picked an until date.
              if (f === 'one_off') setUntil('');
            }}
          >
            <Text style={[styles.chipText, freq === f && styles.chipTextSelected]}>
              {t(`reminder.freq.${f}` as MessageKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Interval (every_n_days: days; weekly: weeks) */}
      {freq === 'every_n_days' && (
        <>
          <Text style={styles.label}>{t('reminder.fieldInterval')}</Text>
          <TextInput
            style={[styles.input, fieldError('interval') ? styles.inputError : null]}
            value={interval}
            onChangeText={setInterval}
            keyboardType="number-pad"
          />
          {fieldError('interval') ? (
            <Text style={styles.errorText}>{fieldError('interval')}</Text>
          ) : null}
        </>
      )}
      {freq === 'weekly' && (
        <>
          <Text style={styles.label}>{t('reminder.fieldIntervalWeeks')}</Text>
          <TextInput
            testID="reminder-interval-weeks"
            style={[styles.input, fieldError('interval') ? styles.inputError : null]}
            value={interval}
            onChangeText={setInterval}
            keyboardType="number-pad"
            placeholder="1"
            placeholderTextColor={T.input.placeholder}
          />
          {fieldError('interval') ? (
            <Text style={styles.errorText}>{fieldError('interval')}</Text>
          ) : null}
        </>
      )}

      {/* Day-of-week selector — shown only for weekly freq */}
      {freq === 'weekly' && (
        <>
          <Text style={styles.label}>{t('reminder.fieldByDay')}</Text>
          <View style={styles.chipRow}>
            {WEEKDAY_TOKENS.map((tok) => {
              const selected = byDay.includes(tok);
              return (
                <TouchableOpacity
                  key={tok}
                  testID={`reminder-byday-${tok.toLowerCase()}`}
                  style={[styles.chip, styles.byDayChip, selected && styles.chipSelected]}
                  onPress={() => {
                    setByDay((prev) => {
                      const next = selected
                        ? prev.filter((t) => t !== tok)
                        : [...prev, tok];
                      // Maintain canonical order (MO<TU<WE<TH<FR<SA<SU)
                      return next.sort(
                        (a, b) => (WEEKDAY_TOKEN_INDEX[a] ?? 0) - (WEEKDAY_TOKEN_INDEX[b] ?? 0),
                      );
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t(`reminder.byDay.${tok}` as MessageKey)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {t(`reminder.byDay.${tok}` as MessageKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {fieldError('byDay') ? (
            <Text style={styles.errorText}>{t('reminder.errorByDayRequired')}</Text>
          ) : null}
        </>
      )}

      {/* Times of day (only for daily / every_n_days / weekly) */}
      {freq !== 'one_off' && (
        <>
          <Text style={styles.label}>{t('reminder.fieldTimesOfDay')}</Text>
          {timesOfDay.map((tod, idx) => (
            <View key={idx} style={styles.todRow}>
              {/* Time-of-day Pressable that opens time picker */}
              <TouchableOpacity
                style={[
                  styles.pickerField,
                  styles.todPickerField,
                  fieldError('timesOfDay') ? styles.inputError : null,
                ]}
                onPress={() => openTodPicker(idx)}
                accessibilityRole="button"
                accessibilityLabel={`${t('reminder.fieldTimesOfDay')} ${idx + 1}: ${tod}`}
              >
                <Text style={styles.pickerFieldText}>{tod}</Text>
                <Text style={styles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
              </TouchableOpacity>
              {timesOfDay.length > 1 && (
                <TouchableOpacity
                  style={styles.todRemoveBtn}
                  onPress={() => removeTimeOfDay(idx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  // 🟡 fix: glyph-only "✕" had no accessibilityLabel — was
                  // announced with no meaning to screen readers.
                  accessibilityLabel={`${t('general.clear')} ${t('reminder.fieldTimesOfDay')} ${idx + 1}`}
                >
                  <Text style={styles.todRemoveText} accessibilityElementsHidden>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity style={styles.addTimeBtn} onPress={addTimeOfDay}>
            <Text style={styles.addTimeBtnText}>{t('reminder.addTime')}</Text>
          </TouchableOpacity>
          {fieldError('timesOfDay') ? (
            <Text style={styles.errorText}>{fieldError('timesOfDay')}</Text>
          ) : null}
        </>
      )}

      {/* Until (optional) — hidden for one_off (meaningless + server rejects it) */}
      {freq !== 'one_off' && (
        <>
          <Text style={styles.label}>{t('reminder.fieldUntil')}</Text>
          <View style={styles.untilRow}>
            <TouchableOpacity
              style={[
                styles.pickerField,
                styles.untilPickerField,
                fieldError('until') ? styles.inputError : null,
              ]}
              onPress={openUntilPicker}
              accessibilityRole="button"
              accessibilityLabel={
                until.trim()
                  ? `${t('reminder.fieldUntil')}: ${formatCivilDate(until.trim(), locale as Locale)}`
                  : t('reminder.untilPlaceholder')
              }
            >
              <Text style={[styles.pickerFieldText, !until.trim() && styles.pickerFieldPlaceholder]}>
                {until.trim() ? formatCivilDate(until.trim(), locale as Locale) : t('reminder.untilPlaceholder')}
              </Text>
              <Text style={styles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
            </TouchableOpacity>
            {until.trim() ? (
              <TouchableOpacity
                style={styles.untilClearBtn}
                onPress={() => setUntil('')}
                accessibilityRole="button"
                accessibilityLabel={t('general.clear')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.untilClearText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {fieldError('until') ? (
            <Text style={styles.errorText}>{fieldError('until')}</Text>
          ) : null}
        </>
      )}

      {/* Active toggle */}
      <View style={styles.row}>
        <Text style={styles.label}>{t('reminder.fieldActive')}</Text>
        <Switch
          value={active}
          onValueChange={setActive}
          trackColor={{ true: T.color.list.bar.pregnancy, false: T.color.surface.divider }}
          thumbColor={T.color.text.onDark}
        />
      </View>

      {/* Notification carry-forward note */}
      <Text style={styles.carryForwardNote}>
        {t('reminder.notificationCarryForward')}
      </Text>

      {/* Save */}
      <TouchableOpacity
        testID="reminder-save"
        style={styles.saveBtn}
        onPress={handleSave}
        accessibilityRole="button"
      >
        <Text style={styles.saveBtnText}>{t('reminder.save')}</Text>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>{t('reminder.delete')}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        testID="reminder-cancel"
        style={styles.cancelBtn}
        onPress={onCancel}
        accessibilityRole="button"
      >
        <Text style={styles.cancelBtnText}>{t('general.cancel')}</Text>
      </TouchableOpacity>

      {/* ── Android pickers — rendered directly as native dialogs ── */}
      {Platform.OS === 'android' && activePicker !== null && (
        <DateTimePicker
          mode={activePickerMode}
          display={activePickerMode === 'time' ? 'spinner' : 'default'}
          value={tempPickerValue}
          onChange={handlePickerChangeAndroid}
          is24Hour={activePickerMode === 'time'}
        />
      )}

      {/* ── iOS bottom-sheet picker Modal ── */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={activePicker !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setActivePicker(null)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <View style={styles.pickerBtnRow}>
                <TouchableOpacity
                  style={styles.pickerCancelBtn}
                  onPress={() => setActivePicker(null)}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.cancel')}
                >
                  <Text style={styles.pickerCancelText}>{t('general.cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>
                  {activePickerMode === 'date' ? t('picker.selectDate') : t('picker.selectTime')}
                </Text>
                <TouchableOpacity
                  testID="reminder-picker-done"
                  style={styles.pickerDoneBtn}
                  onPress={confirmPickerIOS}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.done')}
                >
                  <Text style={styles.pickerDoneText}>{t('general.done')}</Text>
                </TouchableOpacity>
              </View>
              {/* Re-render picker only when modal is visible (activePicker !== null) */}
              {activePicker !== null && (
                <DateTimePicker
                  mode={activePickerMode}
                  display="spinner"
                  value={tempPickerValue}
                  onChange={handlePickerChangeIOS}
                  is24Hour={activePickerMode === 'time'}
                  style={styles.iosPicker}
                />
              )}
            </View>
          </View>
        </Modal>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.color.surface.base, padding: T.spacing[4] },
  label: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.botanical,
    fontWeight: '600',
    marginTop: T.spacing[4],
    marginBottom: T.spacing[1],
  },
  // 🟡 fix: was a hardcoded ~48dp-ish input (paddingV 12 + fontSize 15, no
  // explicit minHeight) — now uses T.input.height (52dp) per token contract.
  input: {
    fontFamily: T.type.bodyLarge.fontFamily,
    backgroundColor: T.input.bg,
    borderRadius: T.radius.sm,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: T.spacing[4],
    minHeight: T.input.height,
    fontSize: 15,
    color: T.color.text.heading,
  },
  inputError: { borderColor: T.input.border.error },
  errorText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    color: T.input.errorText,
    marginTop: T.spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.spacing[4],
    marginBottom: T.spacing[1],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: T.spacing[2], marginBottom: T.spacing[1] },
  // 🟡 fix: chips were ~32-36dp tall (paddingV 6 + ~18sp text) — below ≥48dp
  // touch target. Added explicit minHeight + centered content.
  chip: {
    paddingHorizontal: T.spacing[3],
    paddingVertical: T.spacing[2],
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: T.radius.sm,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    backgroundColor: T.input.bg,
  },
  /** byDay chips are square-ish for uniform weekday labels (จ/อ/พ etc.) */
  byDayChip: {
    paddingHorizontal: T.spacing[2],
    minWidth: 48,
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: T.color.surface.wash.roselle,
    borderColor: T.color.list.bar.pregnancy,
  },
  chipText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
  },
  chipTextSelected: { color: T.color.text.primary, fontWeight: '600' },

  // ── Milestone preset section (B2 ห้องแม่) ──
  presetSection: { marginTop: 4 },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: T.radius.md,
    borderWidth: 1,
    borderColor: T.color.list.bar.pregnancy,
    backgroundColor: T.color.surface.wash.roselle,
    minHeight: 48,
    justifyContent: 'center',
  },
  presetChipText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    fontWeight: '600',
  },

  // ── Picker field (replaces TextInput for date/time) ──
  // 🟡 fix: aligned to T.input.height (52dp) + token padding, matching `input`.
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.input.bg,
    borderRadius: T.radius.sm,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    paddingHorizontal: T.spacing[4],
    minHeight: T.input.height,
  },
  pickerFieldText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    flex: 1,
    fontSize: 15,
    color: T.color.text.heading,
  },
  pickerFieldPlaceholder: { color: T.color.text.primary },
  pickerChevron: { fontSize: 18, color: T.color.text.primary, marginLeft: T.spacing[2] },

  // Times-of-day row
  todRow: { flexDirection: 'row', alignItems: 'center', marginBottom: T.spacing[2] },
  todPickerField: { flex: 1 },
  // 🟡 fix: was padding:10 (~36x36 with a 16sp glyph) — below ≥48dp touch target.
  todRemoveBtn: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: T.spacing[2],
  },
  todRemoveText: { color: T.color.text.primary, fontSize: 16 },
  addTimeBtn: {
    marginTop: T.spacing[1],
    marginBottom: T.spacing[1],
    paddingVertical: T.spacing[3],
    minHeight: 48,
    justifyContent: 'center',
  },
  addTimeBtnText: {
    fontFamily: T.type.caption.fontFamily,
    color: T.color.text.botanical,
    fontSize: 14,
    fontWeight: '600',
  },

  // Until row (field + clear button)
  untilRow: { flexDirection: 'row', alignItems: 'center' },
  untilPickerField: { flex: 1 },
  // 🟡 fix: was padding:10 (~36x36 with a 16sp glyph) — below ≥48dp touch target.
  untilClearBtn: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: T.spacing[2],
  },
  untilClearText: { color: T.color.text.primary, fontSize: 16 },

  // 🟡 fix: removed fontStyle:'italic' — faux-italic on Sarabun (no true italic
  // face shipped) renders as a synthetic shear that distorts Thai glyph shapes.
  carryForwardNote: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 11,
    color: T.color.text.primary,
    marginTop: T.spacing[4],
    marginBottom: T.spacing[1],
  },

  // ── Bottom-sheet picker modal (iOS) ──
  pickerOverlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    paddingBottom: 32,
  },
  pickerBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
  },
  pickerCancelBtn: { minHeight: 44, justifyContent: 'center' },
  pickerCancelText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    color: T.color.text.primary,
  },
  pickerTitle: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    color: T.color.text.heading,
    fontWeight: '600',
    textAlign: 'center',
  },
  pickerDoneBtn: { minHeight: 44, justifyContent: 'center' },
  pickerDoneText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    color: T.color.accent.interactive,
    fontWeight: '600',
  },
  iosPicker: { alignSelf: 'center' },

  saveBtn: {
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    color: T.color.text.onDark,
    fontSize: 16,
    fontWeight: '700',
  },
  deleteBtn: {
    borderColor: T.color.list.bar.pregnancy,
    borderWidth: 1,
    borderRadius: T.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  deleteBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    color: T.color.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8, marginBottom: 32 },
  cancelBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    color: T.color.text.primary,
    fontSize: 15,
  },
});
