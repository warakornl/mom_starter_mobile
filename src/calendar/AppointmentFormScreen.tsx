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
  Modal,
  Platform,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { v4 as uuidv4 } from 'uuid';
import { useT } from '../i18n/LanguageContext';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { createCalendarSyncClient } from '../sync/syncClient';
import { executePush } from '../sync/pushOrchestrator';
import type { TokenStorage } from '../auth/tokenStorage';
import type { ChecklistItemRecord, ChecklistItemCategory } from '../sync/syncTypes';
import { localCivilToday } from '../pregnancy/gestationalAge';
import { toCivilDate, toCivilTime, parseCivilDate, parseCivilTime } from './dateTimePickerFormat';
import { formatCivilDate } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { setPendingCalendarFocusDate } from './pendingCalendarFocusDate';
import type { AncFormPrefill } from '../suggestion/types';
import {
  initAppointmentFormState,
  buildChecklistItemToCreate,
} from './appointmentFormPrefill';
import { buildAncReminderRecord } from './ancReminderBuilder';
import { T } from '../theme/tokens';
import type { Lifecycle } from '../pregnancy/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppointmentFormScreenProps {
  /** Existing item to edit; undefined = create new appointment. */
  existingItem?: ChecklistItemRecord;
  /**
   * ANC suggestion prefill payload — mutually exclusive with existingItem.
   * When provided the form opens in CREATE mode with pre-filled fields from the
   * ANC cadence suggestion (Surface 5, §2.3).
   *
   * INV-A4: nothing is written until the mother taps Save.
   * Cancel with prefill → 0 rows + empty sync queue (no side effect).
   */
  prefill?: AncFormPrefill;
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
  /**
   * ห้องแม่ B2 loss-state gate: lifecycle='ended' → suppress week-indexed dateLabel.
   * Undefined = unknown/not loaded; must NEVER suppress content (GAP-2).
   */
  lifecycle?: Lifecycle;
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
  prefill,
  defaultCategory = 'appointment',
  tokenStorage,
  apiBaseUrl,
  onSave,
  onCancel,
  lifecycle,
}: AppointmentFormScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const isEdit = !!existingItem;

  // ── Form initialization (existingItem ?? prefill ?? default) ───────────────
  const initState = initAppointmentFormState({
    existingItem,
    prefill,
    locale,
    defaultCategory,
  });

  // Parse existing note (R-A: location/doctor were folded in)
  const parsedNote = parseNote(existingItem?.note ?? '');

  // ── Form state ─────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(initState.title);
  const [category, setCategory] = useState<ChecklistItemCategory>(initState.category);
  const [date, setDate] = useState(initState.date);
  const [time, setTime] = useState(initState.time);
  const [allDay, setAllDay] = useState(initState.allDay);
  const [location, setLocation] = useState(parsedNote.location);
  const [doctor, setDoctor] = useState(parsedNote.doctor);
  const [extraNote, setExtraNote] = useState(parsedNote.extra);
  const [titleError, setTitleError] = useState('');
  const [dateError, setDateError] = useState('');
  /**
   * Reminder toggle — default OFF per spec §3.6b.
   * Seeded from prefill.attachReminder (always false per AncFormPrefill spec).
   * Only shown when creating from an ANC suggestion (prefill?.fromSuggestion).
   */
  const [attachReminder, setAttachReminder] = useState(
    prefill?.attachReminder ?? false,
  );

  // ── Picker state ───────────────────────────────────────────────────────────
  // showDatePicker / showTimePicker: Android renders the picker as a dialog;
  // iOS renders it inline in a bottom-sheet Modal (see below).
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  // tempPickerDate holds the intermediate Date while the iOS wheel is spinning,
  // so we only commit to state when the user presses "Done".
  // When date is '' (blank — ANC_PREFILL_DATE=OFF), seed the picker with today.
  const [tempPickerDate, setTempPickerDate] = useState<Date>(
    parseCivilDate(initState.date || localCivilToday()),
  );
  const [tempPickerTime, setTempPickerTime] = useState<Date>(parseCivilTime(initState.time));

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
    } else {
      // Use buildChecklistItemToCreate so that source='from_suggestion' and
      // sourceSuggestionStateId are set correctly when prefill is provided (INV-A4).
      const newItemId = uuidv4();
      const created = buildChecklistItemToCreate({
        id: newItemId,
        title: title.trim(),
        category,
        scheduledAt,
        note: note || null,
        now,
        prefill,
      });
      calendarSyncStore.enqueueCreateChecklistItem(created);

      // ── Reminder write (Surface 6) — ONLY when toggle is ON (INV-A4) ────
      // The reminder is enqueued in the same change-set as the checklistItem.
      // Guard: fromSuggestion ensures the reminder path only fires for ANC.
      // PDPA-A4: buildAncReminderRecord enforces generic title + hideOnLockScreen.
      if (attachReminder && prefill?.fromSuggestion) {
        const reminder = buildAncReminderRecord({
          id: uuidv4(),
          checklistItemId: newItemId,
          scheduledAt,
          locale,
          now,
        });
        calendarSyncStore.enqueueCreateReminder(reminder);
      }
    }

    // Signal CalendarScreen to auto-select the appointment's date on focus.
    // Must be set before onSave() / navigation.goBack() so useFocusEffect picks it up.
    setPendingCalendarFocusDate(scheduledAt.slice(0, 10));

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
            onSave?.();
            triggerPush();
          },
        },
      ],
    );
  }

  // ── Date picker handlers ───────────────────────────────────────────────────

  function openDatePicker() {
    // DEF-01 fix: when date is blank (ANC_PREFILL_DATE=OFF), fall back to today so
    // the picker opens at a valid position.  Does NOT write today into the field —
    // date stays '' until the user confirms in the picker (required-field gate intact).
    setTempPickerDate(parseCivilDate(date || localCivilToday()));
    setShowDatePicker(true);
  }

  function handleDateChangeAndroid(_event: DateTimePickerEvent, selectedDate?: Date) {
    setShowDatePicker(false);
    if (selectedDate) {
      setDate(toCivilDate(selectedDate));
    }
  }

  function handleDateChangeIOS(_event: DateTimePickerEvent, selectedDate?: Date) {
    if (selectedDate) setTempPickerDate(selectedDate);
  }

  function confirmDateIOS() {
    setDate(toCivilDate(tempPickerDate));
    setShowDatePicker(false);
  }

  // ── Time picker handlers ───────────────────────────────────────────────────

  function openTimePicker() {
    setTempPickerTime(parseCivilTime(time));
    setShowTimePicker(true);
  }

  function handleTimeChangeAndroid(_event: DateTimePickerEvent, selectedDate?: Date) {
    setShowTimePicker(false);
    if (selectedDate) {
      setTime(toCivilTime(selectedDate));
    }
  }

  function handleTimeChangeIOS(_event: DateTimePickerEvent, selectedDate?: Date) {
    if (selectedDate) setTempPickerTime(selectedDate);
  }

  function confirmTimeIOS() {
    setTime(toCivilTime(tempPickerTime));
    setShowTimePicker(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* ── Disclaimer header band (INV-A6 — rose/50 bg, 100% visible, from-suggestion only) ── */}
      {initState.headerDisclaimer ? (
        <View
          testID="appointment-disclaimer-band"
          style={styles.disclaimerBand}
          accessibilityRole="none"
          accessible={true}
          accessibilityLabel={initState.headerDisclaimer}
        >
          <Text style={styles.disclaimerText}>{initState.headerDisclaimer}</Text>
        </View>
      ) : null}

      {/* Title */}
      <Text style={styles.label}>{t('appointment.fieldTitle')}</Text>
      <TextInput
        testID="appointment-title"
        style={[styles.input, titleError ? styles.inputError : null]}
        value={title}
        onChangeText={setTitle}
        placeholder={t('appointment.titlePlaceholder')}
        placeholderTextColor={T.input.placeholder}
        autoFocus={!isEdit}
        returnKeyType="next"
      />
      {titleError ? <Text style={styles.errorText}>{titleError}</Text> : null}

      {/* Category note */}
      <Text style={styles.hint}>
        {t(`appointment.category.${category}` as Parameters<typeof t>[0])}
      </Text>

      {/* Date — Pressable that opens DateTimePicker */}
      {/* Flag-driven dateLabel: use prefill.dateLabel when from-suggestion, else generic key.
          B2 loss-gate: suppress week-indexed dateLabel when lifecycle='ended' (spec §3). */}
      <Text style={styles.label}>
        {lifecycle !== 'ended' && initState.dateLabel
          ? initState.dateLabel
          : t('appointment.fieldDate')}
      </Text>
      <TouchableOpacity
        testID="appointment-date"
        style={[styles.pickerField, dateError ? styles.inputError : null]}
        onPress={openDatePicker}
        accessibilityRole="button"
        accessibilityLabel={`${t('appointment.fieldDate')}: ${date ? formatCivilDate(date, locale as Locale) : t('appointment.datePlaceholder')}`}
      >
        {/* DEF-01 fix: guard against blank date (ANC_PREFILL_DATE=OFF) — show
            placeholder instead of calling formatCivilDate('') which produces garbled
            output.  Blank date still fails validate() / required-field gate. */}
        <Text style={styles.pickerFieldText}>
          {date ? formatCivilDate(date, locale as Locale) : t('appointment.datePlaceholder')}
        </Text>
        <Text style={styles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
      </TouchableOpacity>

      {/* All-day toggle */}
      <View style={styles.row}>
        <Text style={styles.label}>{t('appointment.allDay')}</Text>
        <Switch
          testID="appointment-allday"
          value={allDay}
          onValueChange={setAllDay}
          trackColor={{ true: T.color.list.bar.pregnancy, false: T.color.surface.divider }}
          thumbColor={T.color.text.onDark}
        />
      </View>

      {/* Time — Pressable that opens DateTimePicker (hidden when all-day) */}
      {!allDay && (
        <>
          <Text style={styles.label}>{t('appointment.fieldTime')}</Text>
          <TouchableOpacity
            testID="appointment-time"
            style={[styles.pickerField, dateError ? styles.inputError : null]}
            onPress={openTimePicker}
            accessibilityRole="button"
            accessibilityLabel={`${t('appointment.fieldTime')}: ${time}`}
          >
            <Text style={styles.pickerFieldText}>{time}</Text>
            <Text style={styles.pickerChevron} accessibilityElementsHidden={true}>›</Text>
          </TouchableOpacity>
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
        placeholderTextColor={T.input.placeholder}
      />

      {/* Doctor (R-A: folded into note) */}
      <Text style={styles.label}>{t('appointment.fieldDoctor')}</Text>
      <TextInput
        style={styles.input}
        value={doctor}
        onChangeText={setDoctor}
        placeholder={t('appointment.doctorPlaceholder')}
        placeholderTextColor={T.input.placeholder}
      />

      {/* Extra note */}
      <Text style={styles.label}>{t('appointment.fieldNote')}</Text>
      <Text style={styles.hint}>{t('appointment.noteFormatHint')}</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={extraNote}
        onChangeText={setExtraNote}
        placeholder={t('appointment.notePlaceholder')}
        placeholderTextColor={T.input.placeholder}
        multiline
        numberOfLines={3}
      />

      {/* ── Reminder toggle (Surface 6 — from-suggestion only, default OFF) ── */}
      {/* Only shown when creating from an ANC suggestion.
          PDPA-A4 helper note: lock-screen notification uses a generic title. */}
      {prefill?.fromSuggestion && !isEdit ? (
        <View style={styles.reminderRow} testID="appointment-reminder-section">
          <View style={styles.reminderLabelCol}>
            <Text style={styles.label}>{t('appointment.reminder.toggleLabel')}</Text>
            <Text style={styles.hint}>{t('appointment.reminder.lead')}</Text>
            {attachReminder ? (
              <Text
                style={styles.pdpaNote}
                testID="appointment-reminder-pdpa-note"
                accessibilityRole="none"
              >
                {t('appointment.reminder.lockScreenNote')}
              </Text>
            ) : null}
          </View>
          <Switch
            testID="appointment-reminder-toggle"
            value={attachReminder}
            onValueChange={setAttachReminder}
            trackColor={{ true: T.color.list.bar.pregnancy, false: T.color.surface.divider }}
            thumbColor={T.color.text.onDark}
            accessibilityLabel={t('appointment.reminder.toggleLabel')}
          />
        </View>
      ) : null}

      {/* Buttons */}
      <TouchableOpacity
        testID="appointment-save"
        style={styles.saveBtn}
        onPress={handleSave}
        accessibilityRole="button"
      >
        <Text style={styles.saveBtnText}>{t('appointment.save')}</Text>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>{t('appointment.delete')}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        testID="appointment-cancel"
        style={styles.cancelBtn}
        onPress={onCancel}
        accessibilityRole="button"
      >
        <Text style={styles.cancelBtnText}>{t('general.cancel')}</Text>
      </TouchableOpacity>

      {/* ── Date picker — Android: dialog rendered directly; iOS: Modal ── */}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          mode="date"
          display="default"
          value={parseCivilDate(date || localCivilToday())}
          onChange={handleDateChangeAndroid}
        />
      )}

      {/* ── Time picker — Android ── */}
      {Platform.OS === 'android' && showTimePicker && (
        <DateTimePicker
          mode="time"
          display="spinner"
          value={parseCivilTime(time)}
          onChange={handleTimeChangeAndroid}
          is24Hour
        />
      )}

      {/* ── Date picker — iOS bottom sheet ── */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <View style={styles.pickerBtnRow}>
                <TouchableOpacity
                  style={styles.pickerCancelBtn}
                  onPress={() => setShowDatePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.cancel')}
                >
                  <Text style={styles.pickerCancelText}>{t('general.cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>{t('picker.selectDate')}</Text>
                <TouchableOpacity
                  testID="appointment-date-picker-done"
                  style={styles.pickerDoneBtn}
                  onPress={confirmDateIOS}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.done')}
                >
                  <Text style={styles.pickerDoneText}>{t('general.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                mode="date"
                display="spinner"
                value={tempPickerDate}
                onChange={handleDateChangeIOS}
                style={styles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* ── Time picker — iOS bottom sheet ── */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showTimePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowTimePicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <View style={styles.pickerBtnRow}>
                <TouchableOpacity
                  style={styles.pickerCancelBtn}
                  onPress={() => setShowTimePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.cancel')}
                >
                  <Text style={styles.pickerCancelText}>{t('general.cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>{t('picker.selectTime')}</Text>
                <TouchableOpacity
                  testID="appointment-time-picker-done"
                  style={styles.pickerDoneBtn}
                  onPress={confirmTimeIOS}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.done')}
                >
                  <Text style={styles.pickerDoneText}>{t('general.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                mode="time"
                display="spinner"
                value={tempPickerTime}
                onChange={handleTimeChangeIOS}
                is24Hour
                style={styles.iosPicker}
              />
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
  /**
   * Disclaimer header band — roselle wash bg, always-on, never truncated (INV-A6).
   * Full-width, no line limit, never behind a "read more" control.
   * PDPA-A4: doctor-signed copy only (INV-A5).
   */
  disclaimerBand: {
    backgroundColor: T.color.surface.wash.roselle,
    borderRadius: T.radius.sm,
    borderWidth: 1,
    borderColor: T.color.list.bar.pregnancy,
    padding: 14,
    marginBottom: 4,
  },
  disclaimerText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    lineHeight: T.type.caption.lineHeight,
    color: T.color.text.primary,
  },
  label: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.botanical,
    fontWeight: '600',
    marginTop: T.spacing[4],
    marginBottom: T.spacing[1],
  },
  hint: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    color: T.color.text.primary,
    marginBottom: 4,
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
  textarea: { minHeight: 80, paddingVertical: T.spacing[3], textAlignVertical: 'top' },
  errorText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    color: T.input.errorText,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.spacing[4],
    marginBottom: T.spacing[1],
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
  pickerChevron: { fontSize: 18, color: T.color.text.primary, marginLeft: 8 },

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

  // Reminder toggle row (Surface 6)
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 16,
    backgroundColor: T.input.bg,
    borderRadius: T.radius.sm,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    padding: 14,
    gap: 12,
  },
  reminderLabelCol: {
    flex: 1,
    gap: 2,
  },
  /**
   * PDPA-A4 helper note — shown inline when reminder toggle is ON.
   * Informs the user that the lock-screen notification uses a generic title.
   * Screen-reader parity: accessibilityRole="none" so it's read naturally in flow.
   */
  pdpaNote: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    lineHeight: 18,
    color: T.color.text.primary,
    marginTop: 4,
  },

  saveBtn: {
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.md,
    minHeight: T.button.primary.height,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: T.spacing[6],
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
    paddingVertical: T.spacing[3],
    alignItems: 'center',
    marginTop: T.spacing[3],
  },
  deleteBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    color: T.color.text.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: T.spacing[3],
    alignItems: 'center',
    marginTop: T.spacing[2],
    marginBottom: T.spacing[8],
  },
  cancelBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    color: T.color.text.primary,
    fontSize: 15,
  },
});
