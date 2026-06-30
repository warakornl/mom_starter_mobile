/**
 * AppointmentFormScreen — add or edit a ChecklistItem with category=appointment.
 *
 * Data contract (FLAG-7 §2 / OQ-CAL-1 PINNED, R-A):
 *   - Appointment = ChecklistItem with category=appointment (NOT a separate entity)
 *   - Location / doctor have NO structured field in MVP — folded into free-text
 *     `note` by the client (R-A: "concatenate into note for storage; never parsed")
 *   - scheduledAt is REQUIRED for appointments (OQ-CAL-2 PINNED):
 *     stored as "YYYY-MM-DDTHH:mm" floating-civil; all-day = "…T00:00"
 *
 * Write path (B1 — sync-only):
 *   All mutations flow through calendarSyncStore → drainQueue() → sync/push.
 *   There is NO direct REST write for checklistItems.
 *
 * Validation (client-mirrors-server 422):
 *   - title required
 *   - scheduledAt required and must be a valid "YYYY-MM-DDTHH:mm"
 *
 * i18n: all strings via useT() / catalog (appointment.* keys).
 *
 * Security: note may contain health-revealing info → do NOT log it.
 *
 * TODO carry-forward: linked reminder (one_off at scheduledAt − 1 day, OQ-CAL-7).
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
import type { TokenStorage } from '../auth/tokenStorage';
import type { ChecklistItemRecord, ChecklistItemCategory } from '../sync/syncTypes';
import { localCivilToday } from '../pregnancy/gestationalAge';
import {
  scheduleAppointmentNotification,
  cancelNotificationsForAppointment,
} from '../notifications/notificationService';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppointmentFormScreenProps {
  /** Existing item to edit; undefined = create new appointment. */
  existingItem?: ChecklistItemRecord;
  /** Category to pre-fill on new items. Defaults to 'appointment'. */
  defaultCategory?: ChecklistItemCategory;
  /** Token storage — required to trigger sync push after save. */
  tokenStorage?: TokenStorage;
  /** API base URL — required to trigger sync push after save. */
  apiBaseUrl?: string;
  /** Called on successful save. */
  onSave?: () => void;
  /** Called on cancel / back. */
  onCancel?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate and build a scheduledAt string from separate date and time inputs.
 * Returns "YYYY-MM-DDTHH:mm" or null if invalid.
 */
function buildScheduledAt(date: string, time: string, allDay: boolean): string | null {
  // Validate date format: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const t = allDay ? '00:00' : time;
  // Validate time format: HH:mm
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [h, min] = t.split(':').map(Number);
  if (h > 23 || min > 59) return null;

  return `${date}T${t}`;
}

/**
 * Build the concatenated note from optional location + doctor + extra note.
 * R-A: client folds location/doctor into the free-text note field.
 * Format: "สถานที่: X\nแพทย์: Y\nหมายเหตุ: Z" (non-empty parts only).
 */
function buildNote(location: string, doctor: string, extra: string): string {
  const parts: string[] = [];
  if (location.trim()) parts.push(`สถานที่: ${location.trim()}`);
  if (doctor.trim()) parts.push(`แพทย์: ${doctor.trim()}`);
  if (extra.trim()) parts.push(extra.trim());
  return parts.join('\n');
}

/** Parse back the concatenated note into its logical parts (for edit mode). */
function parseNote(note: string): { location: string; doctor: string; extra: string } {
  const locationMatch = note.match(/^สถานที่: (.+)$/m);
  const doctorMatch = note.match(/^แพทย์: (.+)$/m);
  let extra = note;
  if (locationMatch) extra = extra.replace(`สถานที่: ${locationMatch[1]}`, '').trim();
  if (doctorMatch) extra = extra.replace(`แพทย์: ${doctorMatch[1]}`, '').trim();
  extra = extra.replace(/^\n+|\n+$/g, '');
  return {
    location: locationMatch?.[1] ?? '',
    doctor: doctorMatch?.[1] ?? '',
    extra,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AppointmentFormScreen({
  existingItem,
  defaultCategory = 'appointment',
  tokenStorage,
  apiBaseUrl,
  onSave,
  onCancel,
}: AppointmentFormScreenProps): React.JSX.Element {
  const { t } = useT();
  const isEdit = !!existingItem;

  // Parse existing scheduledAt
  const existingDate = existingItem?.scheduledAt?.slice(0, 10) ?? localCivilToday();
  const existingTime = existingItem?.scheduledAt?.slice(11, 16) ?? '09:00';
  const existingAllDay = existingItem?.scheduledAt?.endsWith('T00:00') ?? false;

  // Parse existing note (R-A: location/doctor were folded in)
  const parsedNote = parseNote(existingItem?.note ?? '');

  // ── Form state ─────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(existingItem?.title ?? '');
  const [category, setCategory] = useState<ChecklistItemCategory>(
    existingItem?.category ?? defaultCategory,
  );
  const [date, setDate] = useState(existingDate);
  const [time, setTime] = useState(existingTime);
  const [allDay, setAllDay] = useState(existingAllDay);
  const [location, setLocation] = useState(parsedNote.location);
  const [doctor, setDoctor] = useState(parsedNote.doctor);
  const [extraNote, setExtraNote] = useState(parsedNote.extra);
  const [titleError, setTitleError] = useState('');
  const [dateError, setDateError] = useState('');

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
    if (!title.trim()) {
      setTitleError(t('appointment.errorTitleRequired'));
      valid = false;
    } else {
      setTitleError('');
    }
    const sAt = buildScheduledAt(date, time, allDay);
    if (!sAt) {
      setDateError(t('appointment.errorDateRequired'));
      valid = false;
    } else {
      setDateError('');
    }
    return valid;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  function handleSave() {
    if (!validate()) return;
    const scheduledAt = buildScheduledAt(date, time, allDay)!;
    const note = buildNote(location, doctor, extraNote);
    const now = new Date().toISOString();

    if (isEdit && existingItem) {
      const updated: ChecklistItemRecord = {
        ...existingItem,
        title: title.trim(),
        category,
        scheduledAt,
        note: note || null,
        updatedAt: now,
      };
      calendarSyncStore.enqueueUpdateChecklistItem(updated);
      // Cancel stale notification then re-schedule at the updated time.
      void cancelNotificationsForAppointment(updated.id).then(() =>
        scheduleAppointmentNotification(updated),
      ).catch(() => { /* no-op: notification scheduling is best-effort */ });
    } else {
      const created: ChecklistItemRecord = {
        id: uuidv4(),
        category,
        title: title.trim(),
        scheduledAt,
        done: false,
        note: note || null,
        source: 'user_created',
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      calendarSyncStore.enqueueCreateChecklistItem(created);
      // Schedule appointment notification (30 min lead-time; skips if past).
      void scheduleAppointmentNotification(created).catch(() => { /* no-op */ });
    }

    // Navigate back first, then push (fire-and-forget — no await to not block UI)
    onSave?.();
    triggerPush();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  function handleDelete() {
    if (!existingItem) return;
    Alert.alert(
      t('appointment.deleteConfirmTitle'),
      t('appointment.deleteConfirmMsg'),
      [
        { text: t('appointment.deleteConfirmCancel'), style: 'cancel' },
        {
          text: t('appointment.deleteConfirmOk'),
          style: 'destructive',
          onPress: () => {
            calendarSyncStore.enqueueDeleteChecklistItem(existingItem.id);
            // Cancel pending notification for this appointment.
            void cancelNotificationsForAppointment(existingItem.id).catch(() => { /* no-op */ });
            onSave?.();
            triggerPush();
          },
        },
      ],
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* Title */}
      <Text style={styles.label}>{t('appointment.fieldTitle')}</Text>
      <TextInput
        style={[styles.input, titleError ? styles.inputError : null]}
        value={title}
        onChangeText={setTitle}
        placeholder={t('appointment.titlePlaceholder')}
        placeholderTextColor="#94818A"
        autoFocus={!isEdit}
        returnKeyType="next"
      />
      {titleError ? <Text style={styles.errorText}>{titleError}</Text> : null}

      {/* Category note */}
      <Text style={styles.hint}>
        {t(`appointment.category.${category}` as Parameters<typeof t>[0])}
      </Text>

      {/* Date */}
      <Text style={styles.label}>{t('appointment.fieldDate')}</Text>
      <TextInput
        style={[styles.input, dateError ? styles.inputError : null]}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#94818A"
        keyboardType="numbers-and-punctuation"
      />

      {/* All-day toggle */}
      <View style={styles.row}>
        <Text style={styles.label}>{t('appointment.allDay')}</Text>
        <Switch
          value={allDay}
          onValueChange={setAllDay}
          trackColor={{ true: '#A8505A', false: '#EBE1D9' }}
          thumbColor="#FFFFFF"
        />
      </View>

      {/* Time (hidden when all-day) */}
      {!allDay && (
        <>
          <Text style={styles.label}>{t('appointment.fieldTime')}</Text>
          <TextInput
            style={[styles.input, dateError ? styles.inputError : null]}
            value={time}
            onChangeText={setTime}
            placeholder="HH:mm"
            placeholderTextColor="#94818A"
            keyboardType="numbers-and-punctuation"
          />
        </>
      )}
      {dateError ? <Text style={styles.errorText}>{dateError}</Text> : null}

      {/* Location (R-A: folded into note) */}
      <Text style={styles.label}>{t('appointment.fieldLocation')}</Text>
      <TextInput
        style={styles.input}
        value={location}
        onChangeText={setLocation}
        placeholder={t('appointment.locationPlaceholder')}
        placeholderTextColor="#94818A"
      />

      {/* Doctor (R-A: folded into note) */}
      <Text style={styles.label}>{t('appointment.fieldDoctor')}</Text>
      <TextInput
        style={styles.input}
        value={doctor}
        onChangeText={setDoctor}
        placeholder={t('appointment.doctorPlaceholder')}
        placeholderTextColor="#94818A"
      />

      {/* Extra note */}
      <Text style={styles.label}>{t('appointment.fieldNote')}</Text>
      <Text style={styles.hint}>{t('appointment.noteFormatHint')}</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={extraNote}
        onChangeText={setExtraNote}
        placeholder={t('appointment.notePlaceholder')}
        placeholderTextColor="#94818A"
        multiline
        numberOfLines={3}
      />

      {/* Buttons */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>{t('appointment.save')}</Text>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>{t('appointment.delete')}</Text>
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
  hint: { fontSize: 12, color: '#94818A', marginBottom: 4 },
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
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  errorText: { fontSize: 12, color: '#A8505A', marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
