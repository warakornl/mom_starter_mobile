/**
 * CaptureScreen — Quick Capture / Self-log form (capture-ui.md §2/§3/§4/§5).
 *
 * The ONE reusable form for self-log entries (weight · blood_pressure · swelling
 * · lochia · symptom). Medication and checklist are separate families (spec §1).
 *
 * Implements:
 *  - Type segmented control (shown on generic "Add"; hidden when pre-set from params)
 *  - Value region that swaps by metricType (§3.2/§3.3):
 *      weight           → one numeric field + กก. unit label
 *      blood_pressure   → systolic / diastolic numeric fields + mmHg
 *      swelling/lochia/symptom → descriptive text input (valueText)
 *  - Live echo line (§0 signature): verbatim preview of the Day-Detail row
 *  - Typo-guard validation (§4): ⓘ hint for out-of-range; blocks Save for non-number
 *  - Date/time defaults: now on today / 12:00 on non-today (§2)
 *  - Save → selfLogSyncStore.addSelfLog(SelfLogInput) with base64-encoded fields
 *  - general_health consent gate (self-log-behavior §B.4):
 *      granted → save proceeds; absent/declined → inline nudge modal
 *  - Screen states: empty/filling/invalid/saving/saved/error (§5)
 *  - Writes are local-first (selfLogSyncStore) — no offline state on the form
 *  - All a11y contracts from accessibility-notes.md §2/§4/§8
 *
 * INV-S1 (AC-20): BP 150/95 and 110/70 render with IDENTICAL visual weight —
 * no colour, no grade, no arrow ever appears on a self-log value.
 *
 * INV-S3: Validation copy NEVER says "too high/low," "abnormal," or suggests
 * clinical action — only "double-check this number" (input plausibility guard).
 *
 * Security:
 *  - Value/note fields base64-encoded before passing to selfLogSyncStore (SD-5).
 *  - NEVER log any health value (SD-5 MOTHER-health).
 *  - Call selfLogSyncStore.reset() on logout (PDPA cross-account-leak guard).
 *
 * testIDs:
 *  capture-type-control     — type segmented control (when visible)
 *  capture-type-{type}      — individual type segment button
 *  capture-weight-input     — weight numeric field
 *  capture-systolic-input   — BP systolic field
 *  capture-diastolic-input  — BP diastolic field
 *  capture-text-input       — swelling/lochia/symptom text field
 *  capture-time-display     — time display/picker button
 *  capture-note-input       — optional note field
 *  capture-echo-line        — live preview row
 *  capture-save-btn         — primary Save button
 *  capture-consent-modal    — consent nudge modal
 *  capture-consent-grant    — grant button in modal
 *  capture-consent-not-now  — not-now button in modal
 *  capture-save-error       — error panel
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { SelfLogMetricType } from '../sync/syncTypes';
import type { TokenStorage } from '../auth/tokenStorage';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { consentStore } from '../consent/consentStore';
import { createConsentApiClient } from '../consent/consentApiClient';
import { consentQueue } from '../consent/consentSync';
import { useT } from '../i18n/LanguageContext';
import type { Locale } from '../auth/types';
import { formatCaptureDate } from '../i18n/thaiDate';

import {
  validateWeight,
  validateBP,
  validateTime,
} from './captureValidation';
import {
  buildWeightEchoLine,
  buildBpEchoLine,
  buildTextEchoLine,
} from './captureEcho';
import {
  getDefaultTime,
  isSaveEnabled,
  orchestrateSave,
} from './captureScreenLogic';
import type { SelfLogInput } from '../sync/syncTypes';

// ─── Navigation types ─────────────────────────────────────────────────────────

type CaptureRoute = RouteProp<RootStackParamList, 'Capture'>;
type CaptureNav = NativeStackNavigationProp<RootStackParamList, 'Capture'>;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CaptureScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const METRIC_TYPES: SelfLogMetricType[] = [
  'weight',
  'blood_pressure',
  'swelling',
  'lochia',
  'symptom',
];

/** Build floating-civil today YYYY-MM-DD from device local clock (FLAG-1). */
function localCivilToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD → JS Date at midnight local (for date picker). */
function parseCivilDate(civil: string): Date {
  const [y, m, d] = civil.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a JS Date to YYYY-MM-DD using local clock (no UTC). */
function toCivilDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Consent text version by locale (mirrors useJitConsent pattern). */
function consentTextVersion(locale: Locale): string {
  return locale === 'en' ? 'v1.0-en' : 'v1.0-th';
}

// ─── Sub-components: Value regions ───────────────────────────────────────────

interface WeightRegionProps {
  value: string;
  onChangeText: (v: string) => void;
  hint: string | null;
  unit: string;
}

function WeightRegion({ value, onChangeText, hint, unit }: WeightRegionProps): React.JSX.Element {
  return (
    <View style={fieldStyles.regionContainer}>
      <View style={fieldStyles.numericRow}>
        <TextInput
          testID="capture-weight-input"
          style={[fieldStyles.numericInput, hint ? fieldStyles.numericInputHint : undefined]}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="0.0"
          placeholderTextColor="#94818A"
          accessibilityLabel={`น้ำหนัก กิโลกรัม ช่องข้อความ / Weight, kilograms, edit text`}
          returnKeyType="done"
        />
        <Text style={fieldStyles.unitLabel} accessibilityElementsHidden>{unit}</Text>
      </View>
      {hint !== null && (
        <View style={fieldStyles.hintRow}>
          <Text style={fieldStyles.hintIcon} accessibilityElementsHidden>ⓘ</Text>
          <Text
            style={fieldStyles.hintText}
            accessibilityLiveRegion="polite"
            accessibilityLabel={hint}
          >
            {hint}
          </Text>
        </View>
      )}
    </View>
  );
}

interface BpRegionProps {
  systolic: string;
  diastolic: string;
  onSystolicChange: (v: string) => void;
  onDiastolicChange: (v: string) => void;
  systolicHint: string | null;
  diastolicHint: string | null;
  unit: string;
}

function BpRegion({
  systolic,
  diastolic,
  onSystolicChange,
  onDiastolicChange,
  systolicHint,
  diastolicHint,
  unit,
}: BpRegionProps): React.JSX.Element {
  return (
    <View style={fieldStyles.regionContainer}>
      <View style={fieldStyles.bpRow}>
        <TextInput
          testID="capture-systolic-input"
          style={[
            fieldStyles.bpField,
            (systolicHint !== null) ? fieldStyles.numericInputHint : undefined,
          ]}
          value={systolic}
          onChangeText={onSystolicChange}
          keyboardType="number-pad"
          placeholder="120"
          placeholderTextColor="#94818A"
          accessibilityLabel="ซิสโตลิก mmHg / Systolic, mmHg, edit text"
          returnKeyType="next"
        />
        <Text style={fieldStyles.bpSeparator} accessibilityElementsHidden>/</Text>
        <TextInput
          testID="capture-diastolic-input"
          style={[
            fieldStyles.bpField,
            (diastolicHint !== null) ? fieldStyles.numericInputHint : undefined,
          ]}
          value={diastolic}
          onChangeText={onDiastolicChange}
          keyboardType="number-pad"
          placeholder="78"
          placeholderTextColor="#94818A"
          accessibilityLabel="ไดแอสโตลิก mmHg / Diastolic, mmHg, edit text"
          returnKeyType="done"
        />
        <Text style={fieldStyles.unitLabel} accessibilityElementsHidden>{unit}</Text>
      </View>
      {(systolicHint !== null || diastolicHint !== null) && (
        <View style={fieldStyles.hintRow}>
          <Text style={fieldStyles.hintIcon} accessibilityElementsHidden>ⓘ</Text>
          <Text
            style={fieldStyles.hintText}
            accessibilityLiveRegion="polite"
            accessibilityLabel={systolicHint ?? diastolicHint ?? ''}
          >
            {systolicHint ?? diastolicHint}
          </Text>
        </View>
      )}
    </View>
  );
}

interface TextRegionProps {
  metricType: 'swelling' | 'lochia' | 'symptom';
  /** Locale-aware metric label from i18n — t('capture.type.*') */
  metricLabel: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}

function TextRegion({ metricLabel, value, onChangeText, placeholder }: TextRegionProps): React.JSX.Element {
  return (
    <View style={fieldStyles.regionContainer}>
      <TextInput
        testID="capture-text-input"
        style={fieldStyles.textInput}
        value={value}
        onChangeText={onChangeText}
        multiline
        numberOfLines={3}
        placeholder={placeholder}
        placeholderTextColor="#94818A"
        accessibilityLabel={`${metricLabel}, ช่องข้อความ / edit text`}
        textAlignVertical="top"
      />
    </View>
  );
}

// ─── Sub-component: Type segmented control ────────────────────────────────────

interface TypeControlProps {
  selected: SelfLogMetricType;
  onSelect: (t: SelfLogMetricType) => void;
  typeLabel: (t: SelfLogMetricType) => string;
}

function TypeSegmentedControl({ selected, onSelect, typeLabel }: TypeControlProps): React.JSX.Element {
  return (
    <View testID="capture-type-control" style={segStyles.row} accessibilityRole="tablist">
      {METRIC_TYPES.map((t) => (
        <TouchableOpacity
          key={t}
          testID={`capture-type-${t}`}
          style={[segStyles.chip, selected === t && segStyles.chipSelected]}
          onPress={() => onSelect(t)}
          accessibilityRole="tab"
          accessibilityState={{ selected: selected === t }}
          accessibilityLabel={typeLabel(t)}
        >
          <Text style={[segStyles.chipText, selected === t && segStyles.chipTextSelected]}>
            {typeLabel(t)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Sub-component: Consent nudge modal ──────────────────────────────────────

interface ConsentNudgeProps {
  visible: boolean;
  isLoading: boolean;
  onGrant: () => void;
  onNotNow: () => void;
  title: string;
  body: string;
  grantLabel: string;
  notNowLabel: string;
  changeLaterNote: string;
}

function ConsentNudgeModal({
  visible,
  isLoading,
  onGrant,
  onNotNow,
  title,
  body,
  grantLabel,
  notNowLabel,
  changeLaterNote,
}: ConsentNudgeProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onNotNow}
      accessibilityViewIsModal
    >
      <View style={consentStyles.overlay}>
        <View
          testID="capture-consent-modal"
          style={consentStyles.sheet}
        >
          <ScrollView contentContainerStyle={consentStyles.content} showsVerticalScrollIndicator={false}>
            <Text style={consentStyles.title}>{title}</Text>
            <Text style={consentStyles.body}>{body}</Text>
            <TouchableOpacity
              testID="capture-consent-grant"
              style={[consentStyles.grantBtn, isLoading && consentStyles.grantBtnLoading]}
              onPress={isLoading ? undefined : onGrant}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={grantLabel}
              accessibilityState={{ disabled: isLoading }}
            >
              {isLoading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={consentStyles.grantBtnText}>{grantLabel}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              testID="capture-consent-not-now"
              style={consentStyles.notNowBtn}
              onPress={onNotNow}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={notNowLabel}
            >
              <Text style={[consentStyles.notNowText, isLoading && consentStyles.notNowDisabled]}>
                {notNowLabel}
              </Text>
            </TouchableOpacity>
            <Text style={consentStyles.changeLaterNote}>{changeLaterNote}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function CaptureScreen({ tokenStorage, apiBaseUrl }: CaptureScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const route = useRoute<CaptureRoute>();
  const navigation = useNavigation<CaptureNav>();

  // ── Route params ──────────────────────────────────────────────────────────
  const presetType = route.params?.metricType;
  const paramDate = route.params?.loggedAtDate;
  const paramTime = route.params?.defaultTime;

  const todayCivil = localCivilToday();
  const initialDate = paramDate ?? todayCivil;
  const initialTime = paramTime ?? getDefaultTime(initialDate, todayCivil);

  // ── Form state ────────────────────────────────────────────────────────────
  const [metricType, setMetricType] = useState<SelfLogMetricType>(presetType ?? 'weight');

  // Weight
  const [weightValue, setWeightValue] = useState('');
  // Blood pressure
  const [systolicValue, setSystolicValue] = useState('');
  const [diastolicValue, setDiastolicValue] = useState('');
  // Text value (swelling/lochia/symptom)
  const [textValue, setTextValue] = useState('');
  // Date/time
  const [dateCivil, setDateCivil] = useState(initialDate);
  const [timeStr, setTimeStr] = useState(initialTime);
  // Note
  const [noteText, setNoteText] = useState('');

  // ── Date picker state ─────────────────────────────────────────────────────
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempPickerDate, setTempPickerDate] = useState<Date>(parseCivilDate(initialDate));

  // ── Time picker state (blocker #4 — setTimeStr was never called) ──────────
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempPickerTime, setTempPickerTime] = useState<Date>(() => {
    const [hh, mm] = initialTime.split(':').map(Number);
    const [y, m, d] = initialDate.split('-').map(Number);
    return new Date(y, m - 1, d, hh, mm);
  });

  // ── Screen state ──────────────────────────────────────────────────────────
  type ScreenState = 'idle' | 'saving' | 'saved' | 'error';
  const [screenState, setScreenState] = useState<ScreenState>('idle');

  // ── Consent modal state ───────────────────────────────────────────────────
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);
  // pendingPayloadRef: holds the freshly-built SelfLogInput captured at the
  // moment Save was gated (§B.4). Grant path persists this — no stale closure.
  const pendingPayloadRef = useRef<SelfLogInput | null>(null);

  // ── Validation ────────────────────────────────────────────────────────────
  const weightValidation = validateWeight(weightValue);
  const systolicValidation = validateBP(systolicValue);
  const diastolicValidation = validateBP(diastolicValue);
  const timeValidation = validateTime(timeStr);

  // Text/note don't show inline validation (length cap only — silent counter)
  const textStorable = textValue.trim().length > 0;

  const saveEnabled = isSaveEnabled({
    metricType,
    weightStorable: weightValidation.storable && weightValue.trim().length > 0,
    systolicStorable: systolicValidation.storable && systolicValue.trim().length > 0,
    diastolicStorable: diastolicValidation.storable && diastolicValue.trim().length > 0,
    textStorable,
    timeStorable: timeValidation.storable,
  });

  // ── Echo line (locale-aware labels from i18n — blocker #6) ─────────────────
  const echoLine = (() => {
    switch (metricType) {
      case 'weight':
        return buildWeightEchoLine(
          weightValue,
          timeStr,
          t('capture.type.weight'),
          t('capture.unit.kg'),
        );
      case 'blood_pressure':
        return buildBpEchoLine(
          systolicValue,
          diastolicValue,
          timeStr,
          t('capture.type.blood_pressure'),
          t('capture.unit.mmHg'),
        );
      case 'swelling':
      case 'lochia':
      case 'symptom':
        return buildTextEchoLine(
          t(`capture.type.${metricType}` as Parameters<typeof t>[0]),
          textValue,
          timeStr,
        );
    }
  })();

  // ── Type change resets value fields ───────────────────────────────────────
  function handleTypeChange(t: SelfLogMetricType): void {
    setMetricType(t);
    setWeightValue('');
    setSystolicValue('');
    setDiastolicValue('');
    setTextValue('');
  }

  // ── Consent grant ─────────────────────────────────────────────────────────
  // FIX #1: handleConsentGrant no longer calls handleSave() (stale-callback bug).
  // Instead, it persists pendingPayloadRef.current — the SelfLogInput captured
  // at gate time with the LIVE form values. No stale closure can creep in.
  const handleConsentGrant = useCallback((): void => {
    const version = consentTextVersion(locale as Locale);
    consentStore.setGranted('general_health', true, version);
    setConsentLoading(true);

    void (async () => {
      try {
        const tokens = await tokenStorage.load();
        if (!tokens) throw new Error('no_tokens');
        const client = createConsentApiClient(apiBaseUrl);
        const result = await client.postConsent('general_health', true, version, tokens.accessToken);
        if (!result.ok) {
          // Queue for background retry; keep optimistic store
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
        // Persist the payload captured at gate time — no stale handleSave call
        const pending = pendingPayloadRef.current;
        if (pending) {
          pendingPayloadRef.current = null;
          try {
            selfLogSyncStore.addSelfLog(pending);
            setScreenState('saved');
          } catch {
            setScreenState('error');
          }
        }
      }
    })();
  }, [locale, tokenStorage, apiBaseUrl]);

  // ── Save ──────────────────────────────────────────────────────────────────
  // Uses orchestrateSave (pure function) so payload is always built from LIVE
  // form state. When gated, payload is stored in pendingPayloadRef for the
  // grant path — no stale useCallback closure can drop the entered value.
  const handleSave = useCallback((): void => {
    const result = orchestrateSave({
      saveEnabled,
      consentGranted: consentStore.isGranted('general_health'),
      metricType,
      dateCivil,
      timeStr,
      weightValue: metricType === 'weight' ? weightValue : undefined,
      systolicValue: metricType === 'blood_pressure' ? systolicValue : undefined,
      diastolicValue: metricType === 'blood_pressure' ? diastolicValue : undefined,
      textValue: ['swelling', 'lochia', 'symptom'].includes(metricType) ? textValue : undefined,
      noteText,
    });

    if (result.action === 'skip') return;

    if (result.action === 'gate') {
      // §B.4: hold the fresh payload in a ref; show consent nudge.
      // handleConsentGrant will persist pendingPayloadRef.current after grant.
      pendingPayloadRef.current = result.payload;
      setShowConsentModal(true);
      return;
    }

    // action === 'persist'
    setScreenState('saving');
    try {
      // Local write — sub-100ms; never waits on network (capture-ui §9)
      selfLogSyncStore.addSelfLog(result.payload);
      setScreenState('saved');
    } catch {
      setScreenState('error');
    }
  }, [
    saveEnabled, metricType, weightValue, systolicValue, diastolicValue,
    textValue, dateCivil, timeStr, noteText,
  ]);

  // ── Date picker handlers ──────────────────────────────────────────────────

  function openDatePicker(): void {
    setTempPickerDate(parseCivilDate(dateCivil));
    setShowDatePicker(true);
  }

  function handleDateChangeAndroid(_e: DateTimePickerEvent, d?: Date): void {
    setShowDatePicker(false);
    if (d) setDateCivil(toCivilDate(d));
  }

  function handleDateChangeIOS(_e: DateTimePickerEvent, d?: Date): void {
    if (d) setTempPickerDate(d);
  }

  function confirmDateIOS(): void {
    setDateCivil(toCivilDate(tempPickerDate));
    setShowDatePicker(false);
  }

  // ── Time picker handlers (blocker #4 — wires setTimeStr) ─────────────────

  function openTimePicker(): void {
    const [h, m] = timeStr.split(':').map(Number);
    const [y, mo, d] = dateCivil.split('-').map(Number);
    setTempPickerTime(new Date(y, mo - 1, d, h, m));
    setShowTimePicker(true);
  }

  function handleTimeChangeAndroid(_e: DateTimePickerEvent, d?: Date): void {
    setShowTimePicker(false);
    if (d) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      setTimeStr(`${hh}:${mm}`);
    }
  }

  function handleTimeChangeIOS(_e: DateTimePickerEvent, d?: Date): void {
    if (d) setTempPickerTime(d);
  }

  function confirmTimeIOS(): void {
    const hh = String(tempPickerTime.getHours()).padStart(2, '0');
    const mm = String(tempPickerTime.getMinutes()).padStart(2, '0');
    setTimeStr(`${hh}:${mm}`);
    setShowTimePicker(false);
  }

  // ── Type labels for segmented control ─────────────────────────────────────
  function typeLabel(type: SelfLogMetricType): string {
    const keyMap: Record<SelfLogMetricType, string> = {
      weight: 'capture.type.weight',
      blood_pressure: 'capture.type.blood_pressure',
      swelling: 'capture.type.swelling',
      lochia: 'capture.type.lochia',
      symptom: 'capture.type.symptom',
    };
    return t(keyMap[type] as Parameters<typeof t>[0]);
  }

  // ── Saved confirmation (§5.1) ─────────────────────────────────────────────
  if (screenState === 'saved') {
    // Saved stamp includes date (spec §5.1: "▪ น้ำหนัก 64.2 กก. · 28 มิ.ย. 13:00")
    // Build short date "D MMM" to insert before HH:mm in the echo line.
    const [, mon, day] = dateCivil.split('-').map(Number);
    const TH_M_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const EN_M_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const shortDate = locale === 'th'
      ? `${day} ${TH_M_SHORT[mon - 1]}`
      : `${day} ${EN_M_SHORT[mon - 1]}`;
    const echoForSaved = echoLine.type === 'text'
      ? echoLine.value.replace(` · ${timeStr}`, ` · ${shortDate} ${timeStr}`)
      : '';
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.savedContainer}>
          <Text style={styles.savedStamp}>◉ {t('capture.saved')}</Text>
          {echoForSaved ? (
            <Text style={styles.savedEcho}>{echoForSaved}</Text>
          ) : null}
          <View style={styles.savedActions}>
            <TouchableOpacity
              style={styles.savedSecondaryBtn}
              onPress={() => navigation.navigate('Calendar')}
              accessibilityRole="button"
            >
              <Text style={styles.savedSecondaryBtnText}>{t('capture.viewCalendar')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.savedPrimaryBtn}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel={t('capture.done')}
            >
              <Text style={styles.savedPrimaryBtnText}>{t('capture.done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  const isSaving = screenState === 'saving';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('capture.close')}
          style={styles.headerCloseBtn}
        >
          <Text style={styles.headerCloseText}>‹ {t('capture.close')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('capture.navTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Type segmented control — hidden when pre-set from a specific context */}
        {!presetType && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('capture.typeLabel')}</Text>
            <TypeSegmentedControl
              selected={metricType}
              onSelect={handleTypeChange}
              typeLabel={typeLabel}
            />
          </View>
        )}

        {/* Value region — swaps by metricType */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{typeLabel(metricType)}</Text>
          {metricType === 'weight' && (
            <WeightRegion
              value={weightValue}
              onChangeText={setWeightValue}
              hint={weightValue.trim() ? weightValidation.hint : null}
              unit={t('capture.unit.kg')}
            />
          )}
          {metricType === 'blood_pressure' && (
            <BpRegion
              systolic={systolicValue}
              diastolic={diastolicValue}
              onSystolicChange={setSystolicValue}
              onDiastolicChange={setDiastolicValue}
              systolicHint={systolicValue.trim() ? systolicValidation.hint : null}
              diastolicHint={diastolicValue.trim() ? diastolicValidation.hint : null}
              unit={t('capture.unit.mmHg')}
            />
          )}
          {(metricType === 'swelling' || metricType === 'lochia' || metricType === 'symptom') && (
            <TextRegion
              metricType={metricType}
              metricLabel={t(`capture.type.${metricType}` as Parameters<typeof t>[0])}
              value={textValue}
              onChangeText={setTextValue}
              placeholder={t('capture.field.textPlaceholder')}
            />
          )}
        </View>

        {/* Date / time row (capture-ui §2) — date and time are separately editable */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('capture.field.when')}</Text>
          <View style={styles.dateTimeRow}>
            {/* Date button → opens date picker (blocker #7: localized date) */}
            <TouchableOpacity
              testID="capture-date-display"
              onPress={openDatePicker}
              style={styles.dateTimeBtn}
              accessibilityRole="button"
              accessibilityLabel={`${t('capture.field.when')}: ${formatCaptureDate(dateCivil, locale as Locale)}`}
            >
              <Text style={styles.dateTimeText}>{formatCaptureDate(dateCivil, locale as Locale)}</Text>
              <Text style={styles.dateTimeEditIcon} accessibilityElementsHidden>✎</Text>
            </TouchableOpacity>
            {/* Time button → opens time picker (blocker #4: setTimeStr now wired) */}
            <TouchableOpacity
              testID="capture-time-display"
              onPress={openTimePicker}
              style={styles.dateTimeBtn}
              accessibilityRole="button"
              accessibilityLabel={`${t('capture.field.when')}: ${timeStr}`}
            >
              <Text style={styles.dateTimeText}>{timeStr}</Text>
              <Text style={styles.dateTimeEditIcon} accessibilityElementsHidden>✎</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Optional note (never parsed — INV-S4) */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('capture.field.note')}</Text>
          <TextInput
            testID="capture-note-input"
            style={[styles.input, styles.noteInput]}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            numberOfLines={3}
            placeholder={t('capture.field.notePlaceholder')}
            placeholderTextColor="#94818A"
            accessibilityLabel={t('capture.field.note')}
            textAlignVertical="top"
          />
          <Text style={styles.privacyLine}>{t('capture.notePrivacy')}</Text>
        </View>

        {/* Echo line (signature element — capture-ui §0) */}
        <View style={styles.echoContainer}>
          <Text style={styles.echoLabel}>{t('capture.echoPrefix')}</Text>
          <Text
            testID="capture-echo-line"
            style={echoLine.type === 'text' ? styles.echoText : styles.echoPlaceholder}
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              echoLine.type === 'text'
                ? `${t('capture.echoPrefix')} ${echoLine.value}`
                : t('capture.echoPlaceholder')
            }
          >
            {echoLine.type === 'text' ? echoLine.value : t('capture.echoPlaceholder')}
          </Text>
        </View>

        {/* Error panel (§5 — local write error) */}
        {screenState === 'error' && (
          <View
            testID="capture-save-error"
            style={styles.errorPanel}
            accessibilityLiveRegion="assertive"
          >
            <Text style={styles.errorPanelText}>{t('capture.error')}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => { setScreenState('idle'); handleSave(); }}
              accessibilityRole="button"
              accessibilityLabel={t('capture.retry')}
            >
              <Text style={styles.retryBtnText}>{t('capture.retry')} ›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom spacing so Save button doesn't obscure last field */}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Save button — primary, thumb-anchored (accessibility-notes §2) */}
      <View style={styles.footer}>
        <TouchableOpacity
          testID="capture-save-btn"
          style={[
            styles.saveBtn,
            (!saveEnabled || isSaving) && styles.saveBtnDisabled,
          ]}
          onPress={isSaving ? undefined : handleSave}
          disabled={!saveEnabled || isSaving}
          accessibilityRole="button"
          accessibilityLabel={t('capture.save')}
          accessibilityState={{ disabled: !saveEnabled || isSaving }}
        >
          {isSaving
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Text style={styles.saveBtnText}>{t('capture.save')}</Text>}
        </TouchableOpacity>
      </View>

      {/* Consent nudge modal (general_health gate — §B.4) */}
      <ConsentNudgeModal
        visible={showConsentModal}
        isLoading={consentLoading}
        onGrant={handleConsentGrant}
        onNotNow={() => {
          pendingPayloadRef.current = null;
          setShowConsentModal(false);
        }}
        title={t('capture.consent.title')}
        body={t('capture.consent.body')}
        grantLabel={t('capture.consent.grant')}
        notNowLabel={t('capture.consent.notNow')}
        changeLaterNote={t('capture.consent.changeLater')}
      />

      {/* Date picker — Android: inline dialog */}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          mode="date"
          display="default"
          value={parseCivilDate(dateCivil)}
          onChange={handleDateChangeAndroid}
        />
      )}

      {/* Date picker — iOS: bottom sheet */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={pickerStyles.overlay}>
            <View style={pickerStyles.card}>
              <View style={pickerStyles.btnRow}>
                <TouchableOpacity
                  style={pickerStyles.cancelBtn}
                  onPress={() => setShowDatePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.cancel')}
                >
                  <Text style={pickerStyles.cancelText}>{t('general.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={pickerStyles.doneBtn}
                  onPress={confirmDateIOS}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.done')}
                >
                  <Text style={pickerStyles.doneText}>{t('general.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                mode="date"
                display="spinner"
                value={tempPickerDate}
                onChange={handleDateChangeIOS}
                style={pickerStyles.picker}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Time picker — Android: inline dialog (blocker #4 — wires setTimeStr) */}
      {Platform.OS === 'android' && showTimePicker && (
        <DateTimePicker
          mode="time"
          display="default"
          value={tempPickerTime}
          onChange={handleTimeChangeAndroid}
          is24Hour
        />
      )}

      {/* Time picker — iOS: bottom sheet (blocker #4 — floating-civil, no zone) */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showTimePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowTimePicker(false)}
        >
          <View style={pickerStyles.overlay}>
            <View style={pickerStyles.card}>
              <View style={pickerStyles.btnRow}>
                <TouchableOpacity
                  style={pickerStyles.cancelBtn}
                  onPress={() => setShowTimePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.cancel')}
                >
                  <Text style={pickerStyles.cancelText}>{t('general.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={pickerStyles.doneBtn}
                  onPress={confirmTimeIOS}
                  accessibilityRole="button"
                  accessibilityLabel={t('general.done')}
                >
                  <Text style={pickerStyles.doneText}>{t('general.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                mode="time"
                display="spinner"
                value={tempPickerTime}
                onChange={handleTimeChangeIOS}
                style={pickerStyles.picker}
                is24Hour
              />
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1', // bg/warm-milk
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE1D9', // hairline
  },
  headerCloseBtn: {
    minWidth: 60,
    minHeight: 48,
    justifyContent: 'center',
  },
  headerCloseText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#A8505A', // rose/600
  },
  headerTitle: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30', // ink
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: { width: 60 },

  // Body
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 16,
  },
  section: { gap: 8 },
  sectionLabel: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F4A52', // ink/soft
  },

  // Generic text input (note)
  input: {
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 14,
    padding: 14,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#3A2A30',
    backgroundColor: '#FFFFFF',
  },
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  privacyLine: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#94818A', // ink/faint
    fontStyle: 'italic',
  },

  // Date/time row — holds date + time buttons side by side (blocker #4)
  dateTimeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    gap: 8,
  },
  dateTimeText: {
    fontFamily: 'IBMPlexMono-Regular',
    fontSize: 16,
    lineHeight: 24,
    color: '#3A2A30',
  },
  dateTimeEditIcon: {
    fontSize: 14,
    color: '#94818A',
  },

  // Echo line (capture-ui §0 signature)
  echoContainer: {
    backgroundColor: '#FBF3EE', // surface/page-sunk
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  echoLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#94818A', // ink/faint
  },
  echoText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30', // ink — verbatim, never coloured (INV-S1)
  },
  echoPlaceholder: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#94818A', // ink/faint
    fontStyle: 'italic',
  },

  // Error panel (§5)
  errorPanel: {
    backgroundColor: '#FBEDEE', // rose/50
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorPanelText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44', // rose/700
    flex: 1,
  },
  retryBtn: { paddingLeft: 12, minHeight: 48, justifyContent: 'center' },
  retryBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 14,
    color: '#8E3A44',
  },

  // Footer / Save button
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#EBE1D9',
    // elev/2 equivalent for the bottom action bar (design-system §5.12)
    shadowColor: '#3A2A30',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
    backgroundColor: '#FBF6F1',
  },
  saveBtn: {
    height: 52,
    backgroundColor: '#A8505A', // rose/600
    borderRadius: 999, // radius/pill
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52, // a11y ≥ 48dp
  },
  saveBtnDisabled: {
    backgroundColor: '#DDA0A6', // rose/300 (disabled fill)
  },
  saveBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 17,
    lineHeight: 22,
    color: '#FFFFFF',
  },

  // Saved confirmation (§5.1)
  savedContainer: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: 'center',
  },
  savedStamp: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#4C6B57', // sage/700 (done stamp — design-system §1.3)
    textAlign: 'center',
  },
  savedEcho: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A2A30',
    textAlign: 'center',
    backgroundColor: '#FBF3EE',
    borderRadius: 14,
    padding: 14,
  },
  savedActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  savedSecondaryBtn: {
    height: 48,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedSecondaryBtnText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#5F4A52',
  },
  savedPrimaryBtn: {
    height: 48,
    paddingHorizontal: 24,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedPrimaryBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },

  bottomSpacer: { height: 8 },
});

// ─── Field styles (shared across value regions) ───────────────────────────────

const fieldStyles = StyleSheet.create({
  regionContainer: { gap: 6 },
  numericRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    minHeight: 56,
  },
  numericInput: {
    flex: 1,
    fontFamily: 'IBMPlexMono-Regular', // mono for tabular figures (design-system §2.1)
    fontSize: 22,
    lineHeight: 28,
    color: '#3A2A30',
    paddingVertical: 12,
  },
  numericInputHint: {
    // Hint state: keep ink colour (NEVER status/attention amber — capture-ui §4)
    color: '#3A2A30',
  },
  unitLabel: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52', // ink/soft — non-editable unit suffix (accessibility-notes §8)
    marginLeft: 8,
  },
  // BP: systolic / diastolic row
  bpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    minHeight: 56,
  },
  bpField: {
    fontFamily: 'IBMPlexMono-Regular',
    fontSize: 22,
    lineHeight: 28,
    color: '#3A2A30',
    paddingVertical: 12,
    width: 70,
    textAlign: 'center',
  },
  bpSeparator: {
    fontFamily: 'IBMPlexMono-Regular',
    fontSize: 22,
    color: '#5F4A52',
    paddingHorizontal: 4,
  },
  // Text input for swelling/lochia/symptom
  textInput: {
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 14,
    padding: 14,
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#3A2A30',
    backgroundColor: '#FFFFFF',
    minHeight: 88,
    textAlignVertical: 'top',
  },
  // Hint row (capture-ui §4 — quiet ⓘ in ink/soft, NEVER status/attention)
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintIcon: {
    fontSize: 13,
    color: '#5F4A52', // ink/soft (explicitly NOT status/attention amber)
  },
  hintText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#5F4A52', // ink/soft (capture-ui §4: never amber)
    flex: 1,
  },
});

// ─── Segmented control styles ─────────────────────────────────────────────────

const segStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999, // radius/pill
    borderWidth: 1,
    borderColor: '#EBE1D9',
    backgroundColor: '#FFFFFF',
    minHeight: 48, // a11y ≥ 48dp (blocker #5)
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: '#FBEDEE', // rose/50
    borderColor: '#A8505A',    // rose/600
  },
  chipText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F4A52',
  },
  chipTextSelected: {
    fontFamily: 'IBMPlexSans-SemiBold',
    color: '#8E3A44', // rose/700
  },
});

// ─── Consent nudge modal styles ───────────────────────────────────────────────

const consentStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(58,42,48,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 18,
    lineHeight: 28,
    color: '#3A2A30',
  },
  body: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 25,
    color: '#5F4A52',
  },
  error: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#8E3A44',
    backgroundColor: '#FBEDEE',
    borderRadius: 8,
    padding: 12,
  },
  grantBtn: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  grantBtnLoading: {
    backgroundColor: '#DDA0A6',
  },
  grantBtnText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  notNowBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notNowText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#8E3A44',
  },
  notNowDisabled: { opacity: 0.5 },
  changeLaterNote: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#94818A',
    textAlign: 'center',
  },
});

// ─── iOS Date picker sheet styles ─────────────────────────────────────────────

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(58,42,48,0.4)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE1D9',
  },
  cancelBtn: { minHeight: 48, justifyContent: 'center' as const },
  cancelText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    color: '#94818A',
  },
  doneBtn: { minHeight: 48, justifyContent: 'center' as const },
  doneText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 15,
    color: '#A8505A',
  },
  picker: { alignSelf: 'center' as const },
});
