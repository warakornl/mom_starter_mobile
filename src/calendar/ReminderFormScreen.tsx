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
 * TODO carry-forward:
 *   - OS notification firing (expo-notifications not added; store local alarms
 *     after save using Expo.Notifications.scheduleNotificationAsync)
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
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useT } from '../i18n/LanguageContext';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { createCalendarSyncClient } from '../sync/syncClient';
import { executePush } from '../sync/pushOrchestrator';
import { localCivilToday } from '../pregnancy/gestationalAge';
import type { TokenStorage } from '../auth/tokenStorage';
import type { ReminderRecord, ReminderType, RecurrenceRuleWire } from '../sync/syncTypes';
import type { MessageKey } from '../i18n/messages';

// ─── FLAG-4 grammar validation (client mirror of server 422) ─────────────────

export interface RuleValidationError {
  field: 'freq' | 'interval' | 'timesOfDay' | 'until' | 'startAt';
  message: string;
}

/**
 * Validate a recurrenceRule + startAt against the FLAG-4 grammar.
 * Returns [] on success or an array of errors.
 * Must be a strict subset of the server's validation so a passing client form
 * is guaranteed not to produce a server-side 422 validation_error.
 */
export function validateRecurrenceRule(
  freq: string,
  interval: string,
  timesOfDay: string[],
  until: string,
  startAt: string,
): RuleValidationError[] {
  const errors: RuleValidationError[] = [];

  // startAt: must be "YYYY-MM-DDTHH:mm"
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt)) {
    errors.push({ field: 'startAt', message: 'startAt must be YYYY-MM-DDTHH:mm' });
  }

  if (!['one_off', 'daily', 'every_n_days'].includes(freq)) {
    errors.push({ field: 'freq', message: 'Unknown freq' });
    return errors; // can't validate further
  }

  if (freq === 'one_off') {
    // timesOfDay MUST be absent (forbidden for one_off)
    if (timesOfDay.length > 0) {
      errors.push({ field: 'timesOfDay', message: 'timesOfDay is forbidden for one_off' });
    }
    // interval MUST be absent
    if (interval.trim() && interval.trim() !== '1') {
      errors.push({ field: 'interval', message: 'interval must be absent for one_off' });
    }
  } else {
    // daily / every_n_days: timesOfDay required and non-empty
    if (timesOfDay.length === 0) {
      errors.push({ field: 'timesOfDay', message: 'timesOfDay must be non-empty' });
    } else {
      // Validate each time: strict 24h "HH:mm" — rejects 25:00, 08:99 etc.
      for (const t of timesOfDay) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
          errors.push({ field: 'timesOfDay', message: `Invalid time format: ${t}` });
        }
      }
      // Validate ascending (no duplicates)
      for (let i = 1; i < timesOfDay.length; i++) {
        if (timesOfDay[i] <= timesOfDay[i - 1]) {
          errors.push({ field: 'timesOfDay', message: 'timesOfDay must be distinct and ascending' });
          break;
        }
      }
    }

    if (freq === 'every_n_days') {
      const n = Number(interval);
      if (!interval.trim() || !Number.isInteger(n) || n < 1) {
        errors.push({ field: 'interval', message: 'interval must be an integer ≥ 1 for every_n_days' });
      }
    } else if (freq === 'daily') {
      // interval must be absent (or 1)
      if (interval.trim() && interval.trim() !== '1') {
        errors.push({ field: 'interval', message: 'interval must be absent for daily' });
      }
    }
  }

  // until: if provided, must be "YYYY-MM-DD"
  if (until.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(until.trim())) {
    errors.push({ field: 'until', message: 'until must be YYYY-MM-DD' });
  }

  return errors;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStartAt(date: string, time: string): string {
  return `${date}T${time}`;
}

const REMINDER_TYPES: ReminderType[] = [
  'custom', 'medication', 'appointment', 'kick_count', 'feeding', 'supply_restock',
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReminderFormScreenProps {
  existingReminder?: ReminderRecord;
  /** Token storage — required to trigger sync push after save. */
  tokenStorage?: TokenStorage;
  /** API base URL — required to trigger sync push after save. */
  apiBaseUrl?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReminderFormScreen({
  existingReminder,
  tokenStorage,
  apiBaseUrl,
  onSave,
  onCancel,
}: ReminderFormScreenProps): React.JSX.Element {
  const { t } = useT();
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
  const [freq, setFreq] = useState<'one_off' | 'daily' | 'every_n_days'>(
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

  const [errors, setErrors] = useState<RuleValidationError[]>([]);
  const [titleError, setTitleError] = useState('');

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
    const ruleErrors = validateRecurrenceRule(freq, interval, todValidate, until, startAt);
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
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      calendarSyncStore.enqueueCreateReminder(created);
    }

    // TODO carry-forward: schedule OS local notification (expo-notifications)

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
            // TODO carry-forward: cancel OS alarms for this reminder
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* Title */}
      <Text style={styles.label}>{t('reminder.fieldTitle')}</Text>
      <TextInput
        style={[styles.input, titleError ? styles.inputError : null]}
        value={displayTitle}
        onChangeText={setDisplayTitle}
        placeholder={t('reminder.titlePlaceholder')}
        placeholderTextColor="#94818A"
        autoFocus={!isEdit}
      />
      {titleError ? <Text style={styles.errorText}>{titleError}</Text> : null}

      {/* Type picker (simplified tap list) */}
      <Text style={styles.label}>{t('reminder.fieldType')}</Text>
      <View style={styles.chipRow}>
        {REMINDER_TYPES.map((rt) => (
          <TouchableOpacity
            key={rt}
            style={[styles.chip, type === rt && styles.chipSelected]}
            onPress={() => setType(rt)}
          >
            <Text style={[styles.chipText, type === rt && styles.chipTextSelected]}>
              {t(`reminder.type.${rt}` as MessageKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Start date */}
      <Text style={styles.label}>{t('reminder.fieldStartDate')}</Text>
      <TextInput
        style={[styles.input, fieldError('startAt') ? styles.inputError : null]}
        value={startDate}
        onChangeText={setStartDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#94818A"
        keyboardType="numbers-and-punctuation"
      />

      {/* Start time */}
      <Text style={styles.label}>{t('reminder.fieldStartTime')}</Text>
      <TextInput
        style={[styles.input, fieldError('startAt') ? styles.inputError : null]}
        value={startTime}
        onChangeText={setStartTime}
        placeholder="HH:mm"
        placeholderTextColor="#94818A"
        keyboardType="numbers-and-punctuation"
      />
      {fieldError('startAt') ? (
        <Text style={styles.errorText}>{fieldError('startAt')}</Text>
      ) : null}

      {/* Freq */}
      <Text style={styles.label}>{t('reminder.fieldFreq')}</Text>
      <View style={styles.chipRow}>
        {(['one_off', 'daily', 'every_n_days'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, freq === f && styles.chipSelected]}
            onPress={() => setFreq(f)}
          >
            <Text style={[styles.chipText, freq === f && styles.chipTextSelected]}>
              {t(`reminder.freq.${f}` as MessageKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Interval (only for every_n_days) */}
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

      {/* Times of day (only for daily / every_n_days) */}
      {freq !== 'one_off' && (
        <>
          <Text style={styles.label}>{t('reminder.fieldTimesOfDay')}</Text>
          {timesOfDay.map((tod, idx) => (
            <View key={idx} style={styles.todRow}>
              <TextInput
                style={[styles.input, styles.todInput, fieldError('timesOfDay') ? styles.inputError : null]}
                value={tod}
                onChangeText={(v) => updateTimeOfDay(idx, v)}
                placeholder="HH:mm"
                placeholderTextColor="#94818A"
                keyboardType="numbers-and-punctuation"
              />
              {timesOfDay.length > 1 && (
                <TouchableOpacity
                  style={styles.todRemoveBtn}
                  onPress={() => removeTimeOfDay(idx)}
                >
                  <Text style={styles.todRemoveText}>✕</Text>
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

      {/* Until (optional) */}
      <Text style={styles.label}>{t('reminder.fieldUntil')}</Text>
      <TextInput
        style={[styles.input, fieldError('until') ? styles.inputError : null]}
        value={until}
        onChangeText={setUntil}
        placeholder={t('reminder.untilPlaceholder')}
        placeholderTextColor="#94818A"
        keyboardType="numbers-and-punctuation"
      />
      {fieldError('until') ? (
        <Text style={styles.errorText}>{fieldError('until')}</Text>
      ) : null}

      {/* Active toggle */}
      <View style={styles.row}>
        <Text style={styles.label}>{t('reminder.fieldActive')}</Text>
        <Switch
          value={active}
          onValueChange={setActive}
          trackColor={{ true: '#A8505A', false: '#EBE1D9' }}
          thumbColor="#FFFFFF"
        />
      </View>

      {/* Notification carry-forward note */}
      <Text style={styles.carryForwardNote}>
        {t('reminder.notificationCarryForward')}
      </Text>

      {/* Save */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>{t('reminder.save')}</Text>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>{t('reminder.delete')}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelBtnText}>{t('general.cancel')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FBF6F1', padding: 16 },
  label: { fontSize: 13, color: '#5F4A52', fontWeight: '600', marginTop: 16, marginBottom: 4 },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#3A2A30',
  },
  inputError: { borderColor: '#A8505A' },
  errorText: { fontSize: 12, color: '#A8505A', marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    backgroundColor: '#FFFFFF',
  },
  chipSelected: { backgroundColor: '#A8505A', borderColor: '#A8505A' },
  chipText: { fontSize: 13, color: '#5F4A52' },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  todRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  todInput: { flex: 1 },
  todRemoveBtn: { padding: 10, marginLeft: 8 },
  todRemoveText: { color: '#A8505A', fontSize: 16 },
  addTimeBtn: { marginTop: 4, marginBottom: 4 },
  addTimeBtnText: { color: '#3B8C8C', fontSize: 14, fontWeight: '600' },
  carryForwardNote: {
    fontSize: 11,
    color: '#94818A',
    fontStyle: 'italic',
    marginTop: 16,
    marginBottom: 4,
  },
  saveBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  deleteBtn: {
    borderColor: '#A8505A',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  deleteBtnText: { color: '#A8505A', fontSize: 15, fontWeight: '600' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8, marginBottom: 32 },
  cancelBtnText: { color: '#94818A', fontSize: 15 },
});
