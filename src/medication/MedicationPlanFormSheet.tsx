/**
 * MedicationPlanFormSheet — bottom-sheet form for Add/Edit medication plans.
 *
 * Displayed as a Modal anchored to the bottom of the screen.
 * Reuses FLAG-4 schedule picker pattern from ReminderFormScreen (DateTimePicker).
 *
 * Implements medication-plan-ui.md §5:
 *  §5.1 Name field (required; no autocomplete; verbatim → base64)
 *  §5.2 Dose field (optional; verbatim → base64)
 *  §5.3 Schedule picker (3 chips: Daily / Every N days / One time)
 *       FLAG-4 grammar; interval ≥ 2; null = PRN (all 3 chips mean schedule IS set)
 *  §5.4 Active toggle + sub-label (ปิด ≠ ลบประวัติ)
 *  §5.5 Echo / preview line
 *  §5.6 Save (primary rose button; disabled until name + time filled)
 *  §6   Deactivate (1-tap; no dialog) / Reactivate (1-tap); Delete (2-step confirm panel)
 *  §7.2 general_health consent nudge (inline warm nudge; values held via pendingRef)
 *
 * Security:
 *  - name + dose are verbatim plaintext IN THIS COMPONENT (encoded at save by logic module)
 *  - NEVER log name, dose (SD-2/SD-5)
 *  - NEVER console.log scheduleRule (SD-5)
 *  - No sensitive fields in route params (passed via callbacks only — PDPA SD-9)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { useT } from '../i18n/LanguageContext';
import { formatCivilDate, type MessageKey } from '../i18n/messages';
import type { Locale } from '../auth/types';
import { toCivilDate, toCivilTime, parseCivilDate, parseCivilTime } from '../calendar/dateTimePickerFormat';
import { localCivilToday } from '../pregnancy/gestationalAge';
import {
  validateMedSchedule,
  isMedSaveEnabled,
  type SchedulePickerState,
  type MedValidationErrors,
} from './medicationPlanFormLogic';
import type { MedicationPlan } from '../sync/syncTypes';
import { decodeFieldFromBase64 } from '../capture/captureScreenLogic';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivePicker = 'startDate' | 'startTime' | `tod-${number}` | null;

export interface MedicationPlanFormSheetProps {
  visible: boolean;
  /** Edit mode when present; add mode when absent. */
  existingPlan?: MedicationPlan;
  /** Whether a save is in progress (shows spinner state on button). */
  isSaving: boolean;
  /** Whether to show the general_health consent nudge. */
  showConsentNudge: boolean;
  /** Called when form values are submitted for save. */
  onSave: (
    name: string,
    dose: string,
    pickerState: SchedulePickerState,
    active: boolean,
  ) => void;
  /** Called when the deactivate shortcut (1-tap) is pressed. */
  onDeactivate: (id: string) => void;
  /** Called when the reactivate shortcut (1-tap) is pressed. */
  onReactivate: (id: string) => void;
  /** Called when delete is confirmed (2-step). */
  onDelete: (id: string) => void;
  /** Called when user taps "Enable logging ›" consent CTA. */
  onManageConsents: () => void;
  onClose: () => void;
}

// ─── Default picker state factory ────────────────────────────────────────────

function defaultPickerState(today: string): SchedulePickerState {
  return {
    freq: 'daily',
    startDate: today,
    startTime: '08:00',
    timesOfDay: ['08:00'],
    interval: 2,
  };
}

// ─── Decode name/dose for display ────────────────────────────────────────────
// Security: result is display-only — DO NOT log decoded values (SD-2/SD-5).
function safeDecodeForDisplay(b64: string | null | undefined): string {
  if (!b64) return '';
  return decodeFieldFromBase64(b64) ?? '';
}

// ─── Echo/preview text for the schedule ──────────────────────────────────────

function buildEchoText(
  state: SchedulePickerState,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  locale: string,
): string {
  const { freq, startDate, timesOfDay, startTime, interval } = state;
  const datePart = formatCivilDate(startDate, locale as Locale);
  if (freq === 'one_off') {
    return `${datePart} ${startTime}`;
  }
  const timeList = [...timesOfDay].sort().join(', ');
  if (freq === 'daily') {
    return `${t('medication.scheduleChip.daily')} · ${timeList} · ${datePart}`;
  }
  return `${t('medication.scheduleChip.every_n_days').replace('N', String(interval))} · ${timeList} · ${datePart}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MedicationPlanFormSheet({
  visible,
  existingPlan,
  isSaving,
  showConsentNudge,
  onSave,
  onDeactivate,
  onReactivate,
  onDelete,
  onManageConsents,
  onClose,
}: MedicationPlanFormSheetProps): React.JSX.Element {
  const { t, locale } = useT();
  const isEdit = existingPlan != null;

  // ── Form state ─────────────────────────────────────────────────────────────
  // Security: name/dose hold PLAINTEXT from the TextInput — NEVER log them.
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [active, setActive] = useState(true);
  const [picker, setPicker] = useState<SchedulePickerState>(defaultPickerState(localCivilToday()));

  // Validation: only shown after first Save attempt
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errors, setErrors] = useState<MedValidationErrors>({
    nameError: '',
    timeError: '',
    intervalError: '',
  });

  // Delete confirm panel (2-step, inside sheet)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Date/time picker state (mirrors ReminderFormScreen pattern) ────────────
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [tempPickerValue, setTempPickerValue] = useState<Date>(new Date());

  // ── Populate from existingPlan (edit mode) ────────────────────────────────
  useEffect(() => {
    if (!visible) {
      // Reset form on close
      setName('');
      setDose('');
      setActive(true);
      setPicker(defaultPickerState(localCivilToday()));
      setHasSubmitted(false);
      setErrors({ nameError: '', timeError: '', intervalError: '' });
      setShowDeleteConfirm(false);
      setActivePicker(null);
      return;
    }

    if (existingPlan) {
      // Edit mode: decode name/dose for display.
      // Security: decoded values are display-only; DO NOT log (SD-2/SD-5).
      setName(safeDecodeForDisplay(existingPlan.name));
      setDose(safeDecodeForDisplay(existingPlan.dose));
      setActive(existingPlan.active);

      const rule = existingPlan.scheduleRule;
      if (rule) {
        const ruleDate = rule.startAt.slice(0, 10);
        const ruleTime = rule.startAt.slice(11, 16);
        setPicker({
          freq: rule.freq,
          startDate: ruleDate,
          startTime: ruleTime,
          timesOfDay: rule.timesOfDay ? [...rule.timesOfDay] : [ruleTime],
          interval: rule.interval ?? 2,
        });
      } else {
        // PRN plan — default to daily for edit (user can change)
        setPicker(defaultPickerState(localCivilToday()));
      }
    } else {
      // Add mode: reset to defaults
      setName('');
      setDose('');
      setActive(true);
      setPicker(defaultPickerState(localCivilToday()));
    }
    setHasSubmitted(false);
    setErrors({ nameError: '', timeError: '', intervalError: '' });
    setShowDeleteConfirm(false);
  }, [visible, existingPlan]);

  // ── Picker handlers (mirrors ReminderFormScreen) ───────────────────────────

  function openPicker(kind: ActivePicker, initialDate: Date) {
    setTempPickerValue(initialDate);
    setActivePicker(kind);
  }

  function updateTimeOfDay(idx: number, time: string) {
    setPicker((prev) => {
      const next = [...prev.timesOfDay];
      next[idx] = time;
      return { ...prev, timesOfDay: next };
    });
  }

  function handlePickerChangeAndroid(_event: DateTimePickerEvent, selectedDate?: Date) {
    const kind = activePicker;
    setActivePicker(null);
    if (!selectedDate) return;

    if (kind === 'startDate') {
      setPicker((prev) => ({ ...prev, startDate: toCivilDate(selectedDate) }));
    } else if (kind === 'startTime') {
      setPicker((prev) => ({ ...prev, startTime: toCivilTime(selectedDate) }));
    } else if (kind !== null && kind.startsWith('tod-')) {
      const idx = Number(kind.slice(4));
      updateTimeOfDay(idx, toCivilTime(selectedDate));
    }
  }

  function handlePickerChangeIOS(_event: DateTimePickerEvent, selectedDate?: Date) {
    if (selectedDate) setTempPickerValue(selectedDate);
  }

  function confirmPickerIOS() {
    const kind = activePicker;
    setActivePicker(null);

    if (kind === 'startDate') {
      setPicker((prev) => ({ ...prev, startDate: toCivilDate(tempPickerValue) }));
    } else if (kind === 'startTime') {
      setPicker((prev) => ({ ...prev, startTime: toCivilTime(tempPickerValue) }));
    } else if (kind !== null && kind.startsWith('tod-')) {
      const idx = Number(kind.slice(4));
      updateTimeOfDay(idx, toCivilTime(tempPickerValue));
    }
  }

  const activePickerMode: 'date' | 'time' = (() => {
    if (activePicker === 'startDate') return 'date';
    return 'time';
  })();

  // ── Freq chip selection ────────────────────────────────────────────────────

  function selectFreq(freq: SchedulePickerState['freq']) {
    setPicker((prev) => ({
      ...prev,
      freq,
      // Re-seed times when switching to a freq that needs them
      timesOfDay: freq !== 'one_off'
        ? (prev.timesOfDay.length > 0 ? prev.timesOfDay : ['08:00'])
        : [],
    }));
  }

  // ── Time-of-day chips ─────────────────────────────────────────────────────

  function addTimeOfDay() {
    setPicker((prev) => ({ ...prev, timesOfDay: [...prev.timesOfDay, '08:00'] }));
  }

  function removeTimeOfDay(idx: number) {
    setPicker((prev) => ({
      ...prev,
      timesOfDay: prev.timesOfDay.filter((_, i) => i !== idx),
    }));
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveEnabled = isMedSaveEnabled(name, picker);

  const handleSave = useCallback(() => {
    setHasSubmitted(true);
    const errs = validateMedSchedule(name, picker);
    setErrors(errs);
    if (errs.nameError || errs.timeError || errs.intervalError) return;
    if (!saveEnabled) return;
    onSave(name, dose, picker, active);
  }, [name, dose, picker, active, saveEnabled, onSave]);

  // ── Interval stepper ──────────────────────────────────────────────────────

  function incrementInterval() {
    setPicker((prev) => ({ ...prev, interval: (prev.interval ?? 2) + 1 }));
  }

  function decrementInterval() {
    setPicker((prev) => ({
      ...prev,
      interval: Math.max(2, (prev.interval ?? 2) - 1),
    }));
  }

  // ── Echo preview (F1 — open-ring mark + verbatim + "and more" + inactive) ─

  const echoText = buildEchoText(picker, t, locale);

  // F1: Build the full echo line content
  // - open-ring due mark ◯
  // - verbatim name (or placeholder)
  // - verbatim dose if present
  // - first time
  // - "and more" when multiple times
  // - "Planned" tag when active=false
  const echoFirstTime = picker.freq === 'one_off'
    ? picker.startTime
    : ([...picker.timesOfDay].sort()[0] ?? '–');
  const echoMultiTime = picker.freq !== 'one_off' && picker.timesOfDay.length > 1;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
        accessible={false}
      />
      <View style={styles.sheet}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>

          {/* Sheet title + close */}
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {isEdit ? t('medication.editTitle') : t('medication.addTitle')}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('general.cancel')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Consent nudge moved to near Save button (F6) */}

          {/* ── Name ───────────────────────────────────────────────────────── */}
          <Text style={styles.fieldLabel}>{t('medication.fieldName')}</Text>
          <TextInput
            testID="med-name-input"
            style={[styles.input, hasSubmitted && errors.nameError ? styles.inputError : null]}
            value={name}
            onChangeText={setName}
            placeholder={t('medication.fieldName')}
            placeholderTextColor="#94818A"
            autoCorrect={false}
            autoComplete="off"
            // Disable autocomplete/suggestions — spec §5.1 verbatim entry
            textContentType="none"
            accessibilityLabel={t('medication.fieldName')}
          />
          {hasSubmitted && errors.nameError ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {t(errors.nameError as Parameters<typeof t>[0])}
            </Text>
          ) : null}
          {/* F7: name field privacy line with icon/lock glyph (§5.1/§10.3) */}
          <View style={styles.privacyRow} accessibilityElementsHidden>
            <Text style={styles.privacyIcon}>🔒</Text>
            <Text style={styles.privacyLine}>{t('medication.privacyLine')}</Text>
          </View>

          {/* ── Dose ───────────────────────────────────────────────────────── */}
          <Text style={styles.fieldLabel}>{t('medication.fieldDose')}</Text>
          <TextInput
            testID="med-dose-input"
            style={styles.input}
            value={dose}
            onChangeText={setDose}
            placeholder={t('medication.fieldDose')}
            placeholderTextColor="#94818A"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            accessibilityLabel={t('medication.fieldDose')}
          />
          {/* F7: dose field privacy line with icon/lock glyph (§5.2/§10.3) */}
          <View style={styles.privacyRow} accessibilityElementsHidden>
            <Text style={styles.privacyIcon}>🔒</Text>
            <Text style={styles.privacyLine}>{t('medication.privacyLine')}</Text>
          </View>

          {/* ── Schedule picker ────────────────────────────────────────────── */}
          <Text style={styles.fieldLabel}>{t('medication.fieldSchedule')}</Text>

          {/* Freq chips (3 options) — B7: leading check glyph for selected; B8: minHeight ≥48 */}
          <View style={styles.chipRow}>
            {(['daily', 'every_n_days', 'one_off'] as const).map((f) => {
              const isSelected = picker.freq === f;
              return (
                <TouchableOpacity
                  key={f}
                  testID={`med-freq-chip-${f}`}
                  style={[styles.chip, isSelected ? styles.chipActive : null]}
                  onPress={() => selectFreq(f)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={t(`medication.scheduleChip.${f}` as Parameters<typeof t>[0])}
                >
                  {/* B7: icon/check glyph (non-color-only selection cue — §10.3/§5.3) */}
                  {isSelected && (
                    <Text style={styles.chipCheck} accessibilityElementsHidden>✓</Text>
                  )}
                  <Text style={[styles.chipText, isSelected ? styles.chipTextActive : null]}>
                    {t(`medication.scheduleChip.${f}` as Parameters<typeof t>[0])}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Sub-fields: daily / every_n_days */}
          {(picker.freq === 'daily' || picker.freq === 'every_n_days') && (
            <>
              {/* F5: interval stepper appears BEFORE times for every_n_days (§11.2/OQ-MP4/§5.3) */}
              {picker.freq === 'every_n_days' && (
                <View style={styles.intervalRow}>
                  <Text style={styles.fieldLabel}>{t('medication.fieldInterval')}</Text>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      testID="med-interval-dec"
                      style={styles.stepperBtn}
                      onPress={decrementInterval}
                      accessibilityRole="button"
                      accessibilityLabel="−"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.stepperBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text
                      testID="med-interval-value"
                      style={styles.stepperValue}
                      accessibilityLiveRegion="polite"
                    >
                      {picker.interval}
                    </Text>
                    <TouchableOpacity
                      testID="med-interval-inc"
                      style={styles.stepperBtn}
                      onPress={incrementInterval}
                      accessibilityRole="button"
                      accessibilityLabel="+"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.stepperBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  {hasSubmitted && errors.intervalError ? (
                    <Text style={styles.errorText} accessibilityLiveRegion="polite">
                      {t(errors.intervalError as Parameters<typeof t>[0])}
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Times of day */}
              <Text style={styles.fieldLabel}>{t('medication.fieldTimesOfDay')}</Text>
              {picker.timesOfDay.map((time, idx) => (
                <View key={idx} style={styles.timeChipRow}>
                  <TouchableOpacity
                    testID={`med-tod-${idx}`}
                    style={styles.timeChip}
                    onPress={() =>
                      openPicker(`tod-${idx}`, parseCivilTime(time))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${t('medication.fieldTimesOfDay')} ${time}`}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Text style={styles.timeChipText}>{time}</Text>
                  </TouchableOpacity>
                  {picker.timesOfDay.length > 1 && (
                    <TouchableOpacity
                      testID={`med-tod-remove-${idx}`}
                      style={styles.timeChipRemove}
                      onPress={() => removeTimeOfDay(idx)}
                      accessibilityRole="button"
                      accessibilityLabel={t('medication.removeTime')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.timeChipRemoveText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {hasSubmitted && errors.timeError ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {t(errors.timeError as Parameters<typeof t>[0])}
                </Text>
              ) : null}
              {/* F5 (MVP cap OQ-MP4): hide "+ Add a time" for every_n_days — allows ≤1 time only */}
              {picker.freq === 'daily' && (
                <TouchableOpacity
                  testID="med-add-time"
                  style={styles.addTimeBtn}
                  onPress={addTimeOfDay}
                  accessibilityRole="button"
                  accessibilityLabel={t('medication.addTime')}
                >
                  <Text style={styles.addTimeBtnText}>{t('medication.addTime')}</Text>
                </TouchableOpacity>
              )}

              {/* Start date */}
              <Text style={styles.fieldLabel}>{t('medication.fieldStartDate')}</Text>
              <TouchableOpacity
                testID="med-start-date"
                style={styles.dateBtn}
                onPress={() => openPicker('startDate', parseCivilDate(picker.startDate))}
                accessibilityRole="button"
                accessibilityLabel={`${t('medication.fieldStartDate')}: ${formatCivilDate(picker.startDate, locale as Locale)}`}
              >
                <Text style={styles.dateBtnText}>
                  {formatCivilDate(picker.startDate, locale as Locale)}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Sub-fields: one_off — date + time */}
          {picker.freq === 'one_off' && (
            <>
              <Text style={styles.fieldLabel}>{t('medication.fieldStartDate')}</Text>
              <TouchableOpacity
                testID="med-start-date"
                style={styles.dateBtn}
                onPress={() => openPicker('startDate', parseCivilDate(picker.startDate))}
                accessibilityRole="button"
                accessibilityLabel={`${t('medication.fieldStartDate')}: ${formatCivilDate(picker.startDate, locale as Locale)}`}
              >
                <Text style={styles.dateBtnText}>
                  {formatCivilDate(picker.startDate, locale as Locale)}
                </Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>{t('medication.fieldTimesOfDay')}</Text>
              <TouchableOpacity
                testID="med-start-time"
                style={styles.dateBtn}
                onPress={() => openPicker('startTime', parseCivilTime(picker.startTime))}
                accessibilityRole="button"
                accessibilityLabel={`${t('medication.timeField')}: ${picker.startTime}`}
              >
                <Text style={styles.dateBtnText}>{picker.startTime}</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Echo / preview line (F1 — §5.5: signature trust device) ──── */}
          <View
            style={styles.echoRow}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.echoPrefix}>{t('medication.echoPrefix')}</Text>
            {/* F1: open-ring due mark + verbatim name · dose · first time */}
            <View style={styles.echoOccurrenceRow} testID="med-echo">
              <Text style={[styles.echoRingMark, !active && styles.echoRingMarkInactive]}>
                ◯
              </Text>
              <Text
                style={[styles.echoOccurrenceText, !active && styles.echoOccurrenceTextInactive]}
              >
                {name.trim()
                  ? `${name.trim()}${dose.trim() ? ` · ${dose.trim()}` : ''}    ${echoFirstTime}${echoMultiTime ? `  ${t('medication.echoAndMore')}` : ''}`
                  : t('medication.echoPlaceholder')
                }
              </Text>
            </View>
            {/* F1: "Planned" tag when active=false */}
            {!active && (
              <Text style={styles.echoPlannedTag}>{t('medication.echoPlanned')}</Text>
            )}
          </View>

          {/* ── Active toggle ──────────────────────────────────────────────── */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelGroup}>
              <Text style={styles.toggleLabel}>{t('medication.fieldActive')}</Text>
              <Text style={styles.toggleSubLabel}>
                {active
                  ? t('medication.activeSubLabelOn')
                  : t('medication.activeSubLabelOff')}
              </Text>
            </View>
            <Switch
              testID="med-active-toggle"
              value={active}
              onValueChange={setActive}
              trackColor={{ false: '#EBE1D9', true: '#A8505A' }}
              thumbColor={active ? '#FFFFFF' : '#94818A'}
              accessibilityRole="switch"
              accessibilityLabel={t('medication.fieldActive')}
              accessibilityState={{ checked: active }}
            />
          </View>

          {/* ── Consent nudge (F6: positioned near Save, below Active toggle) */}
          {showConsentNudge && (
            <View style={styles.consentNudge} accessibilityLiveRegion="polite">
              <Text style={styles.consentNudgeTitle}>{t('medication.consentNudgeTitle')}</Text>
              <TouchableOpacity
                style={styles.consentNudgeBtn}
                onPress={onManageConsents}
                accessibilityRole="button"
                accessibilityLabel={t('medication.consentNudgeAction')}
              >
                <Text style={styles.consentNudgeBtnText}>{t('medication.consentNudgeAction')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Save button (F6: disabled + label update when nudge shown; M5: spinner) */}
          <TouchableOpacity
            testID="med-save-btn"
            style={[
              styles.saveBtn,
              (!saveEnabled || isSaving || showConsentNudge) ? styles.saveBtnDisabled : null,
            ]}
            onPress={handleSave}
            disabled={!saveEnabled || isSaving || showConsentNudge}
            accessibilityRole="button"
            accessibilityLabel={
              showConsentNudge
                ? t('medication.saveDisabledConsentLabel')
                : t('medication.save')
            }
            accessibilityState={{ disabled: !saveEnabled || isSaving || showConsentNudge }}
          >
            {/* M5: 16dp inline spinner instead of '…' text */}
            {isSaving
              ? <ActivityIndicator size={16} color="#FFFFFF" />
              : <Text style={styles.saveBtnText}>{t('medication.save')}</Text>
            }
          </TouchableOpacity>

          {/* ── Edit-mode actions (F4: sub-copy + Quiet variant) ─────────────── */}
          {isEdit && existingPlan && !showDeleteConfirm && (
            <View style={styles.editActions}>
              <View style={styles.hairlineDivider} />

              {existingPlan.active ? (
                <View style={styles.actionGroup}>
                  <TouchableOpacity
                    testID="med-deactivate-btn"
                    style={styles.actionBtn}
                    onPress={() => onDeactivate(existingPlan.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t('medication.deactivate')}
                  >
                    <Text style={styles.actionBtnText}>{t('medication.deactivate')}</Text>
                  </TouchableOpacity>
                  {/* F4: "ปิด ≠ ลบประวัติ" sub-copy */}
                  <Text style={styles.actionSubCopy} accessibilityElementsHidden>
                    {t('medication.deactivateSubCopy1')}
                  </Text>
                  <Text style={styles.actionSubCopy} accessibilityElementsHidden>
                    {t('medication.deactivateSubCopy2')}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  testID="med-reactivate-btn"
                  style={styles.actionBtn}
                  onPress={() => onReactivate(existingPlan.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('medication.reactivate')}
                >
                  <Text style={styles.actionBtnText}>{t('medication.reactivate')}</Text>
                </TouchableOpacity>
              )}

              <View style={styles.actionGroup}>
                <TouchableOpacity
                  testID="med-delete-trigger"
                  style={styles.actionBtn}
                  onPress={() => setShowDeleteConfirm(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('medication.delete')}
                >
                  <Text style={styles.actionBtnText}>{t('medication.delete')}</Text>
                </TouchableOpacity>
                {/* F4: delete sub-copy */}
                <Text style={styles.actionSubCopy} accessibilityElementsHidden>
                  {t('medication.deleteSubCopy1')}
                </Text>
                <Text style={styles.actionSubCopy} accessibilityElementsHidden>
                  {t('medication.deleteSubCopy2')}
                </Text>
              </View>
            </View>
          )}

          {/* ── Delete confirm panel (2-step; Cancel = Primary rose/600) ────── */}
          {isEdit && existingPlan && showDeleteConfirm && (
            <View style={styles.deletePanel} accessibilityLiveRegion="polite">
              <Text style={styles.deletePanelTitle}>
                {t('medication.deleteConfirmTitle').replace('{name}', safeDecodeForDisplay(existingPlan.name))}
              </Text>
              <Text style={styles.deletePanelBody}>{t('medication.deleteConfirmBody1')}</Text>
              <Text style={styles.deletePanelBody}>{t('medication.deleteConfirmBody2')}</Text>
              {/* Cancel = Primary (rose/600) — spec §6 "Cancel-as-primary" */}
              <TouchableOpacity
                testID="med-delete-cancel"
                style={styles.deleteCancelBtn}
                onPress={() => setShowDeleteConfirm(false)}
                accessibilityRole="button"
                accessibilityLabel={t('medication.deleteConfirmCancel')}
              >
                <Text style={styles.deleteCancelBtnText}>{t('medication.deleteConfirmCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="med-delete-confirm"
                style={styles.deleteConfirmBtn}
                onPress={() => onDelete(existingPlan.id)}
                accessibilityRole="button"
                accessibilityLabel={t('medication.deleteConfirmOk')}
              >
                <Text style={styles.deleteConfirmBtnText}>{t('medication.deleteConfirmOk')}</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>

        {/* ── Android DateTimePicker (inline dialog) ────────────────────── */}
        {Platform.OS === 'android' && activePicker !== null && (
          <DateTimePicker
            mode={activePickerMode}
            value={tempPickerValue}
            display="default"
            onChange={handlePickerChangeAndroid}
          />
        )}

        {/* ── iOS DateTimePicker (bottom sheet panel with confirm) ────────── */}
        {Platform.OS === 'ios' && (
          <Modal
            visible={activePicker !== null}
            transparent
            animationType="slide"
          >
            <View style={styles.iosPickerBackdrop}>
              <View style={styles.iosPickerPanel}>
                <View style={styles.iosPickerToolbar}>
                  <TouchableOpacity
                    onPress={() => setActivePicker(null)}
                    accessibilityRole="button"
                    accessibilityLabel={t('general.cancel')}
                  >
                    <Text style={styles.iosPickerCancel}>{t('general.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmPickerIOS}
                    accessibilityRole="button"
                    accessibilityLabel={t('medication.confirmPicker')}
                  >
                    <Text style={styles.iosPickerDone}>✓</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  mode={activePickerMode}
                  value={tempPickerValue}
                  display="spinner"
                  onChange={handlePickerChangeIOS}
                  style={styles.iosPickerControl}
                />
              </View>
            </View>
          </Modal>
        )}

      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(58, 42, 48, 0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    // Sheet is anchored to the bottom via the Modal's default layout
  },
  sheetContent: {
    padding: 20,
    paddingBottom: 40,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    fontWeight: '700',
    color: '#3A2A30',
  },
  closeBtn: {
    fontSize: 18,
    color: '#94818A',
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    textAlign: 'center',
    lineHeight: 44,
  },

  // ── Consent nudge ─────────────────────────────────────────────────────────
  consentNudge: {
    backgroundColor: '#FBEDEE',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#A8505A',
  },
  consentNudgeTitle: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 14,
    color: '#3A2A30',
    marginBottom: 8,
  },
  consentNudgeBtn: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  consentNudgeBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#A8505A',
    textDecorationLine: 'underline',
  },

  // ── Fields ────────────────────────────────────────────────────────────────
  fieldLabel: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 14,
    color: '#5F4A52',
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#FBF6F1',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 10,
    padding: 12,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30',
    minHeight: 48,
  },
  inputError: {
    borderColor: '#A8505A',
  },
  errorText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    color: '#A8505A',
    marginTop: 4,
  },
  // F7: privacy row with lock glyph
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    gap: 4,
  },
  privacyIcon: {
    fontSize: 12,
    color: '#94818A',
    lineHeight: 18,
  },
  privacyLine: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A',
    flex: 1,
  },

  // ── Schedule chips (B7: check glyph; B8: minHeight ≥48) ─────────────────
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#EBE1D9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    flexDirection: 'row',
    gap: 4,
  },
  chipActive: {
    borderColor: '#A8505A',
    backgroundColor: '#FBEDEE',
  },
  chipCheck: {
    fontSize: 12,
    color: '#A8505A',
    fontWeight: '700',
  },
  chipText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 13,
    color: '#5F4A52',
  },
  chipTextActive: {
    color: '#A8505A',
    fontWeight: '700',
  },

  // ── Times of day ──────────────────────────────────────────────────────────
  timeChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  timeChip: {
    backgroundColor: '#FBF6F1',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  timeChipText: {
    fontFamily: 'IBMPlexMono-Regular',
    fontSize: 16,
    color: '#3A2A30',
  },
  timeChipRemove: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeChipRemoveText: {
    fontSize: 16,
    color: '#94818A',
  },
  addTimeBtn: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
  },
  addTimeBtnText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 14,
    color: '#A8505A',
  },

  // ── Interval stepper ──────────────────────────────────────────────────────
  intervalRow: {
    marginTop: 4,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#A8505A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 22,
    color: '#A8505A',
    lineHeight: 28,
  },
  stepperValue: {
    fontFamily: 'IBMPlexMono-Regular',
    fontSize: 24,
    color: '#3A2A30',
    minWidth: 40,
    textAlign: 'center',
  },

  // ── Date button ───────────────────────────────────────────────────────────
  dateBtn: {
    backgroundColor: '#FBF6F1',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  dateBtnText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#3A2A30',
  },

  // ── Echo line (F1: open-ring mark + verbatim + inactive treatment) ───────
  echoRow: {
    marginTop: 14,
    backgroundColor: '#FBF6F1',
    borderRadius: 8,
    padding: 10,
  },
  echoPrefix: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A',
    marginBottom: 4,
  },
  echoOccurrenceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  echoRingMark: {
    fontSize: 14,
    color: '#9A7E86', // due ring color (accessibility-notes §1.2)
    lineHeight: 20,
  },
  echoRingMarkInactive: {
    color: '#94818A',
  },
  echoOccurrenceText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 14,
    color: '#3A2A30',
    flex: 1,
  },
  echoOccurrenceTextInactive: {
    color: '#5F4A52',
  },
  echoPlannedTag: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#5F4A52',
    marginTop: 4,
    fontStyle: 'italic',
  },
  // (legacy echoText retained for potential external use)
  echoText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 14,
    color: '#3A2A30',
  },

  // ── Active toggle ─────────────────────────────────────────────────────────
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 8,
  },
  toggleLabelGroup: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#3A2A30',
  },
  toggleSubLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#5F4A52',
    marginTop: 2,
  },

  // ── Save button (Primary rose/600, pill, min-h 52) ────────────────────────
  saveBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 100,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── Edit-mode secondary actions (F4: Quiet variant + sub-copy) ────────────
  editActions: {
    marginTop: 20,
    gap: 4,
  },
  hairlineDivider: {
    height: 1,
    backgroundColor: '#EBE1D9',
    marginBottom: 16,
  },
  actionGroup: {
    marginBottom: 12,
  },
  // Quiet text button (design-system §5.1 Quiet variant — §6)
  actionBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  actionBtnText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 15,
    color: '#5F4A52',
  },
  actionSubCopy: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A',
    marginTop: 2,
  },

  // ── Delete confirm panel ──────────────────────────────────────────────────
  deletePanel: {
    marginTop: 16,
    backgroundColor: '#FBEDEE',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EBE1D9',
  },
  deletePanelTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#3A2A30',
    marginBottom: 8,
  },
  deletePanelBody: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
    marginBottom: 4,
  },
  // Cancel = Primary (rose/600) — spec §6 "Cancel-as-primary" UX pattern
  deleteCancelBtn: {
    backgroundColor: '#A8505A',
    borderRadius: 100,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  deleteCancelBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  deleteConfirmBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  deleteConfirmBtnText: {
    fontFamily: 'IBMPlexSans-Medium',
    fontSize: 15,
    color: '#94818A',
    textDecorationLine: 'underline',
  },

  // ── iOS DateTimePicker panel ──────────────────────────────────────────────
  iosPickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(58, 42, 48, 0.3)',
  },
  iosPickerPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  iosPickerToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE1D9',
  },
  iosPickerCancel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#94818A',
    minWidth: 48,
    minHeight: 44,
    lineHeight: 44,
  },
  iosPickerDone: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    color: '#A8505A',
    minWidth: 48,
    minHeight: 44,
    textAlign: 'right',
    lineHeight: 44,
  },
  iosPickerControl: {
    height: 216,
  },
});
