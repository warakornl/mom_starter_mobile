/**
 * CaptureScreen — Quick Capture form (capture-ui.md §2/§3/§4/§5).
 *
 * Supports two families in one form:
 *   Self-log  (weight · blood_pressure · swelling · lochia · symptom) — §3.2/§3.3
 *   Medication (taken/missed two-state toggle + plan resolution) — §3.1 + Task 9
 *
 * Medication family rules (capture-ui §3.1 + medication-behavior §B):
 *  - Plan name and dose shown VERBATIM — never translated (INV-M4).
 *  - taken and missed use IDENTICAL visual weight; missed is NEVER amber (INV-M2).
 *  - No grade/verdict word anywhere (INV-M1 / AC-20).
 *  - Opened with medicationPlanId → type pre-set + plan resolved + "taken" default.
 *  - Ad-hoc (no medicationPlanId) → planId=null in MedicationLogInput.
 *  - AC-22: server does NOT dedup (medicationPlanId, civil-day); client render collapses.
 *  - Save → medicationLogSyncStore.addLog(MedicationLogInput).
 *
 * Self-log family rules:
 *  - Value region swaps by captureType (weight/BP/swelling/lochia/symptom).
 *  - Typo-guard validation (§4): ⓘ hint for out-of-range; blocks Save for non-number.
 *  - Save → selfLogSyncStore.addSelfLog(SelfLogInput).
 *
 * Shared:
 *  - Type segmented control: hidden when pre-set from params (metricType or medicationPlanId).
 *  - Live echo line (§0 signature): verbatim preview of the Day-Detail row.
 *  - Date/time defaults: now on today / 12:00 on non-today (§2).
 *  - general_health consent gate (§B.4): absent → JIT nudge modal; browsing unblocked.
 *  - Screen states: empty/filling/invalid/saving/saved/error (§5).
 *  - Local-first writes — no offline state on the form.
 *  - All a11y contracts from accessibility-notes.md §2/§4/§8.
 *
 * INV-S1 (AC-20): BP 150/95 and 110/70 render with IDENTICAL visual weight —
 * no colour, no grade, no arrow ever appears on a self-log value.
 *
 * INV-S3: Validation copy NEVER says "too high/low," "abnormal," or suggests
 * clinical action — only "double-check this number" (input plausibility guard).
 *
 * Security:
 *  - Value/note/medication fields base64-encoded before passing to stores (SD-5).
 *  - NEVER log any health value (SD-5 MOTHER-health).
 *  - NEVER log note, occurrenceTime, or medicationPlanId (SD-5).
 *  - Call store reset() on logout (PDPA cross-account-leak guard).
 *
 * testIDs:
 *  capture-type-control          — type segmented control (when visible)
 *  capture-type-{type}           — individual type segment button
 *  capture-weight-input          — weight numeric field
 *  capture-systolic-input        — BP systolic field
 *  capture-diastolic-input       — BP diastolic field
 *  capture-text-input            — swelling/lochia/symptom text field
 *  capture-medication-taken      — taken chip (medication family)
 *  capture-medication-missed     — missed chip (medication family)
 *  capture-time-display          — time display/picker button
 *  capture-note-input            — optional note field
 *  capture-echo-line             — live preview row
 *  capture-save-btn              — primary Save button
 *  capture-consent-modal         — consent nudge modal
 *  capture-consent-grant         — grant button in modal
 *  capture-consent-not-now       — not-now button in modal
 *  capture-save-error            — error panel
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
import { ConsentNudgeModal } from '../consent/ConsentNudgeModal';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { SelfLogMetricType, MedicationLogInput } from '../sync/syncTypes';
import type { TokenStorage } from '../auth/tokenStorage';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
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
  decodeFieldFromBase64,
} from './captureScreenLogic';
import {
  buildMedicationEchoLine,
  orchestrateMedicationSave,
} from './medicationCaptureLogic';
import type { SelfLogInput } from '../sync/syncTypes';
import { T } from '../theme/tokens';

// ─── Navigation types ─────────────────────────────────────────────────────────

type CaptureRoute = RouteProp<RootStackParamList, 'Capture'>;
type CaptureNav = NativeStackNavigationProp<RootStackParamList, 'Capture'>;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CaptureScreenProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * CaptureType extends SelfLogMetricType with the medication family.
 * medication is first so it appears as the leading chip in the type control.
 */
export type CaptureType = SelfLogMetricType | 'medication';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Ordered list of all capture types shown in the type control.
 * medication leads — it is the most frequently accessed via reminder shortcut.
 */
const ALL_CAPTURE_TYPES: CaptureType[] = [
  'medication',
  'weight',
  'blood_pressure',
  'swelling',
  'lochia',
  'symptom',
];

/** Self-log subset (used for self-log-specific logic). */
const SELF_LOG_TYPES: SelfLogMetricType[] = [
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
          placeholderTextColor={T.input.placeholder}
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
          placeholderTextColor={T.input.placeholder}
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
          placeholderTextColor={T.input.placeholder}
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
        placeholderTextColor={T.input.placeholder}
        accessibilityLabel={`${metricLabel}, ช่องข้อความ / edit text`}
        textAlignVertical="top"
      />
    </View>
  );
}

// ─── Sub-component: Medication region ────────────────────────────────────────

interface MedicationRegionProps {
  /** Decoded (UTF-8) plan name — shown VERBATIM (INV-M4). Empty → ad-hoc (no plan). */
  planName: string;
  /** Decoded (UTF-8) dose — shown VERBATIM (INV-M4). Null → no dose line. */
  planDose: string | null;
  /** i18n label: "จากแผนยา" / "From plan" — shown below the plan name. */
  planFromLabel: string;
  /** i18n label: "ขนาด" / "Dose" — prefix for the dose line. */
  doseLabel: string;
  status: 'taken' | 'missed';
  onStatusChange: (s: 'taken' | 'missed') => void;
  /** i18n label for taken, e.g. "กินแล้ว" / "Taken". */
  takenLabel: string;
  /** i18n label for missed, e.g. "ไม่ได้กิน" / "Not taken". */
  missedLabel: string;
  /** i18n section label for the status row, e.g. "สถานะ" / "Status". */
  statusSectionLabel: string;
}

/**
 * Medication value region.
 *
 * Renders:
 *   - Plan name (VERBATIM — INV-M4) with "จากแผนยา" secondary label
 *   - Dose (VERBATIM — INV-M4) when present
 *   - Two-state taken / missed toggle (EQUAL visual weight — INV-M2)
 *
 * INV-M2: Both chips use IDENTICAL styling (chipSelected rose/50 background).
 * The only difference is which label is shown — never amber, never shaming.
 * AC-20: No grade/verdict word anywhere in this component.
 */
function MedicationRegion({
  planName,
  planDose,
  planFromLabel,
  doseLabel,
  status,
  onStatusChange,
  takenLabel,
  missedLabel,
  statusSectionLabel,
}: MedicationRegionProps): React.JSX.Element {
  return (
    <View style={fieldStyles.regionContainer}>
      {/* Plan info — only shown when a plan is linked (INV-M4: verbatim) */}
      {planName.trim() ? (
        <View style={fieldStyles.medPlanBlock}>
          <Text
            style={fieldStyles.medPlanName}
            accessibilityLabel={planName}
          >
            {planName}
          </Text>
          <Text style={fieldStyles.medPlanFrom}>{planFromLabel}</Text>
          {planDose?.trim() ? (
            <Text style={fieldStyles.medDose}>
              {doseLabel} {planDose}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Status toggle — INV-M2: taken and missed have EQUAL visual weight */}
      <View style={fieldStyles.medStatusSection}>
        <Text style={fieldStyles.medStatusLabel}>{statusSectionLabel}</Text>
        <View style={fieldStyles.medStatusChips} accessibilityRole="radiogroup">
          {/*
            INV-M2: Both chips use chipSelected (rose/50 bg) when active.
            "missed" chip NEVER uses amber/attention styling — no shaming.
          */}
          <TouchableOpacity
            testID="capture-medication-taken"
            style={[segStyles.chip, status === 'taken' && segStyles.chipSelected]}
            onPress={() => onStatusChange('taken')}
            accessibilityRole="radio"
            accessibilityState={{ checked: status === 'taken' }}
            accessibilityLabel={takenLabel}
          >
            <Text style={[segStyles.chipText, status === 'taken' && segStyles.chipTextSelected]}>
              {takenLabel}
            </Text>
          </TouchableOpacity>
          {/* INV-M2: same chip style — no distinction in status treatment */}
          <TouchableOpacity
            testID="capture-medication-missed"
            style={[segStyles.chip, status === 'missed' && segStyles.chipSelected]}
            onPress={() => onStatusChange('missed')}
            accessibilityRole="radio"
            accessibilityState={{ checked: status === 'missed' }}
            accessibilityLabel={missedLabel}
          >
            <Text style={[segStyles.chipText, status === 'missed' && segStyles.chipTextSelected]}>
              {missedLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Sub-component: Type segmented control ────────────────────────────────────

interface TypeControlProps {
  selected: CaptureType;
  onSelect: (t: CaptureType) => void;
  typeLabel: (t: CaptureType) => string;
}

function TypeSegmentedControl({ selected, onSelect, typeLabel }: TypeControlProps): React.JSX.Element {
  return (
    <View testID="capture-type-control" style={segStyles.row} accessibilityRole="tablist">
      {ALL_CAPTURE_TYPES.map((t) => (
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export function CaptureScreen({ tokenStorage, apiBaseUrl }: CaptureScreenProps): React.JSX.Element {
  const { t, locale } = useT();
  const route = useRoute<CaptureRoute>();
  const navigation = useNavigation<CaptureNav>();

  // ── Route params ──────────────────────────────────────────────────────────
  const presetType = route.params?.metricType;
  const paramDate = route.params?.loggedAtDate;
  const paramTime = route.params?.defaultTime;
  /**
   * medicationPlanId from route params (UUID only — no health data in params SD-9).
   * When present: pre-set type to 'medication', resolve plan, default to 'taken'.
   */
  const presetMedicationPlanId: string | null = route.params?.medicationPlanId ?? null;

  const todayCivil = localCivilToday();
  const initialDate = paramDate ?? todayCivil;
  const initialTime = paramTime ?? getDefaultTime(initialDate, todayCivil);

  /**
   * Initial CaptureType:
   *   medicationPlanId set → 'medication'
   *   presetType set       → that SelfLogMetricType
   *   neither              → 'weight' (default first self-log type)
   */
  const initialCaptureType: CaptureType =
    presetMedicationPlanId != null
      ? 'medication'
      : (presetType ?? 'weight');

  // ── Plan resolution (sync, no async — INV-M4: verbatim, never translated) ─
  // Resolved once from the in-memory store; presetMedicationPlanId never changes.
  // Security: NEVER log resolvedPlanName or resolvedPlanDose (SD-5).
  const resolvedPlan =
    presetMedicationPlanId != null
      ? medicationPlanSyncStore.getPlan(presetMedicationPlanId)
      : undefined;
  const resolvedPlanName: string = resolvedPlan
    ? (decodeFieldFromBase64(resolvedPlan.name) ?? '')
    : '';
  const resolvedPlanDose: string | null = resolvedPlan
    ? decodeFieldFromBase64(resolvedPlan.dose ?? null)
    : null;

  // ── Form state ────────────────────────────────────────────────────────────
  const [captureType, setCaptureType] = useState<CaptureType>(initialCaptureType);

  // Weight
  const [weightValue, setWeightValue] = useState('');
  // Blood pressure
  const [systolicValue, setSystolicValue] = useState('');
  const [diastolicValue, setDiastolicValue] = useState('');
  // Text value (swelling/lochia/symptom)
  const [textValue, setTextValue] = useState('');
  // Medication status (§B.1: default = 'taken' — INV-M2: both states equal weight)
  const [medicationStatus, setMedicationStatus] = useState<'taken' | 'missed'>('taken');
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
  // pendingMedicationPayloadRef: holds the MedicationLogInput captured at the
  // moment a medication Save was gated. Only one of the two ref is ever non-null
  // at a time (consent modal is shared between self-log and medication paths).
  // Security: NEVER log this ref's contents (SD-5 MOTHER-health).
  const pendingMedicationPayloadRef = useRef<MedicationLogInput | null>(null);

  // ── Validation ────────────────────────────────────────────────────────────
  const weightValidation = validateWeight(weightValue);
  const systolicValidation = validateBP(systolicValue);
  const diastolicValidation = validateBP(diastolicValue);
  const timeValidation = validateTime(timeStr);

  // Text/note don't show inline validation (length cap only — silent counter)
  const textStorable = textValue.trim().length > 0;

  const saveEnabled: boolean =
    captureType === 'medication'
      // Medication: always enabled when time is valid (status has a default — §B.1)
      ? timeValidation.storable
      // Self-log: requires a valid non-empty value for the active metricType
      : isSaveEnabled({
          metricType: captureType as SelfLogMetricType,
          weightStorable: weightValidation.storable && weightValue.trim().length > 0,
          systolicStorable: systolicValidation.storable && systolicValue.trim().length > 0,
          diastolicStorable: diastolicValidation.storable && diastolicValue.trim().length > 0,
          textStorable,
          timeStorable: timeValidation.storable,
        });

  // ── Echo line (locale-aware labels from i18n) ───────────────────────────────
  const echoLine = (() => {
    if (captureType === 'medication') {
      // INV-M4: pass decoded plan name/dose verbatim.
      // INV-M2: buildMedicationEchoLine returns { type:'text' } for BOTH
      //         taken and missed — identical structural output, no shaming.
      return buildMedicationEchoLine(
        resolvedPlanName,
        resolvedPlanDose,
        medicationStatus,
        timeStr,
        t('capture.medication.takenLabel'),
        t('capture.medication.missedLabel'),
      );
    }
    switch (captureType as SelfLogMetricType) {
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
          t(`capture.type.${captureType}` as Parameters<typeof t>[0]),
          textValue,
          timeStr,
        );
    }
  })();

  // ── Type change resets value fields ───────────────────────────────────────
  function handleTypeChange(newType: CaptureType): void {
    setCaptureType(newType);
    // Reset all value fields when switching type
    setWeightValue('');
    setSystolicValue('');
    setDiastolicValue('');
    setTextValue('');
    // Reset medication status to default 'taken' on type change (§B.1)
    setMedicationStatus('taken');
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
        // Drain whichever pending payload was captured at gate time.
        // Only one of the two refs is ever non-null (modal is shared between
        // self-log and medication paths — never both active simultaneously).
        // Security: NEVER log pendingMed contents (SD-5 MOTHER-health).
        const pendingMed = pendingMedicationPayloadRef.current;
        const pendingSelf = pendingPayloadRef.current;
        pendingMedicationPayloadRef.current = null;
        pendingPayloadRef.current = null;
        try {
          if (pendingMed) {
            // Medication grant path — persist the medication log (§B.4).
            medicationLogSyncStore.addLog(pendingMed);
            setScreenState('saved');
          } else if (pendingSelf) {
            // Self-log grant path — persist the self-log entry (§B.4).
            selfLogSyncStore.addSelfLog(pendingSelf);
            setScreenState('saved');
          }
        } catch {
          setScreenState('error');
        }
      }
    })();
  }, [locale, tokenStorage, apiBaseUrl]);

  // ── Save ──────────────────────────────────────────────────────────────────
  // Uses orchestrate* pure functions so payload is always built from LIVE form
  // state. When gated, payload is stored in the relevant pending ref for the
  // grant path — no stale useCallback closure can drop the entered value.
  const handleSave = useCallback((): void => {
    if (captureType === 'medication') {
      // ── Medication save path ─────────────────────────────────────────────
      const medResult = orchestrateMedicationSave({
        saveEnabled,
        consentGranted: consentStore.isGranted('general_health'),
        planId: presetMedicationPlanId,
        status: medicationStatus,
        dateCivil,
        timeStr,
        noteText,
      });

      if (medResult.action === 'skip') return;

      if (medResult.action === 'gate') {
        // §B.4: hold in ref; grant handler dispatches to medicationLogSyncStore.
        // Security: NEVER log medResult.payload contents (SD-5).
        pendingMedicationPayloadRef.current = medResult.payload;
        setShowConsentModal(true);
        return;
      }

      // action === 'persist'
      setScreenState('saving');
      try {
        medicationLogSyncStore.addLog(medResult.payload);
        setScreenState('saved');
      } catch {
        setScreenState('error');
      }
      return;
    }

    // ── Self-log save path ─────────────────────────────────────────────────
    const selfMetricType = captureType as SelfLogMetricType;
    const selfResult = orchestrateSave({
      saveEnabled,
      consentGranted: consentStore.isGranted('general_health'),
      metricType: selfMetricType,
      dateCivil,
      timeStr,
      weightValue: selfMetricType === 'weight' ? weightValue : undefined,
      systolicValue: selfMetricType === 'blood_pressure' ? systolicValue : undefined,
      diastolicValue: selfMetricType === 'blood_pressure' ? diastolicValue : undefined,
      textValue: SELF_LOG_TYPES.includes(selfMetricType) &&
        selfMetricType !== 'weight' && selfMetricType !== 'blood_pressure'
        ? textValue
        : undefined,
      noteText,
    });

    if (selfResult.action === 'skip') return;

    if (selfResult.action === 'gate') {
      // §B.4: hold the fresh payload in a ref; show consent nudge.
      // handleConsentGrant will persist pendingPayloadRef.current after grant.
      pendingPayloadRef.current = selfResult.payload;
      setShowConsentModal(true);
      return;
    }

    // action === 'persist'
    setScreenState('saving');
    try {
      // Local write — sub-100ms; never waits on network (capture-ui §9)
      selfLogSyncStore.addSelfLog(selfResult.payload);
      setScreenState('saved');
    } catch {
      setScreenState('error');
    }
  }, [
    captureType, saveEnabled, presetMedicationPlanId, medicationStatus,
    weightValue, systolicValue, diastolicValue,
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

  // ── Type labels for segmented control and section header ─────────────────
  function typeLabel(type: CaptureType): string {
    if (type === 'medication') return t('capture.type.medication');
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
    // For self-logs: echo ends with ` · HH:mm` so replace that pattern.
    // For medication: echo ends with ` · {statusLabel} HH:mm` — the ` · HH:mm`
    // pattern doesn't match. Use a simpler `timeStr` replacement that works for
    // both: replaces the first (and typically only) occurrence of the time.
    const echoForSaved = echoLine.type === 'text'
      ? echoLine.value.replace(timeStr, `${shortDate} ${timeStr}`)
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
              onPress={() => navigation.navigate('MainTabs')}
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
        {/*
          Type segmented control — hidden when pre-set from a specific context.
          Hidden when: presetType (self-log family) OR medicationPlanId (medication family).
          capture-ui §2: "type control shown on generic Add, hidden on specific-context open".
        */}
        {!presetType && !presetMedicationPlanId && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('capture.typeLabel')}</Text>
            <TypeSegmentedControl
              selected={captureType}
              onSelect={handleTypeChange}
              typeLabel={typeLabel}
            />
          </View>
        )}

        {/* Value region — swaps by captureType */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{typeLabel(captureType)}</Text>

          {/* Medication family (capture-ui §3.1 + medication-behavior §B) */}
          {captureType === 'medication' && (
            <MedicationRegion
              planName={resolvedPlanName}
              planDose={resolvedPlanDose}
              planFromLabel={t('capture.medication.planFromLabel')}
              doseLabel={t('capture.medication.doseLabel')}
              status={medicationStatus}
              onStatusChange={setMedicationStatus}
              takenLabel={t('capture.medication.takenLabel')}
              missedLabel={t('capture.medication.missedLabel')}
              statusSectionLabel={t('capture.medication.statusLabel')}
            />
          )}

          {/* Self-log families */}
          {captureType === 'weight' && (
            <WeightRegion
              value={weightValue}
              onChangeText={setWeightValue}
              hint={weightValue.trim() ? weightValidation.hint : null}
              unit={t('capture.unit.kg')}
            />
          )}
          {captureType === 'blood_pressure' && (
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
          {(captureType === 'swelling' || captureType === 'lochia' || captureType === 'symptom') && (
            <TextRegion
              metricType={captureType as 'swelling' | 'lochia' | 'symptom'}
              metricLabel={t(`capture.type.${captureType}` as Parameters<typeof t>[0])}
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
            placeholderTextColor={T.input.placeholder}
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
          // Clear both pending refs — user dismissed without granting (§B.4).
          pendingPayloadRef.current = null;
          pendingMedicationPayloadRef.current = null;
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
    backgroundColor: T.color.surface.base,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
  },
  headerCloseBtn: {
    minWidth: 60,
    minHeight: 48,
    justifyContent: 'center',
  },
  headerCloseText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 16,
    color: T.color.text.primary,
  },
  headerTitle: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.text.heading,
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
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: T.color.text.primary,
  },

  // Generic text input (note)
  input: {
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 14,
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 16,
    lineHeight: 25,
    color: T.color.text.heading,
    backgroundColor: T.input.bg,
  },
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  privacyLine: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    lineHeight: 18,
    color: T.color.text.primary,
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
    backgroundColor: T.input.bg,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    gap: 8,
  },
  dateTimeText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 16,
    lineHeight: 24,
    color: T.color.text.heading,
  },
  dateTimeEditIcon: {
    fontSize: 14,
    color: T.color.text.primary,
  },

  // Echo line (capture-ui §0 signature)
  echoContainer: {
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
    padding: 14,
    gap: 6,
  },
  echoLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 12,
    lineHeight: 18,
    color: T.color.text.primary,
  },
  echoText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: T.color.text.heading, // INV-S1: verbatim, never coloured
  },
  echoPlaceholder: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: T.color.text.primary,
    fontStyle: 'italic',
  },

  // Error panel (§5)
  errorPanel: {
    backgroundColor: T.color.surface.wash.roselle,
    borderRadius: T.radius.md,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorPanelText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 14,
    color: T.color.text.primary,
    flex: 1,
  },
  retryBtn: { paddingLeft: 12, minHeight: 48, justifyContent: 'center' },
  retryBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 14,
    color: T.color.text.primary,
  },

  // Footer / Save button
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: T.color.surface.divider,
    // elev/2 equivalent for the bottom action bar (design-system §5.12)
    shadowColor: T.color.text.heading,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
    backgroundColor: T.color.surface.base,
  },
  saveBtn: {
    height: 52,
    backgroundColor: T.button.primary.bg,
    borderRadius: 999, // radius/pill
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52, // a11y ≥ 48dp
  },
  saveBtnDisabled: {
    backgroundColor: T.scrim.amber,
  },
  saveBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 17,
    lineHeight: 22,
    color: T.color.text.onDark,
  },

  // Saved confirmation (§5.1)
  savedContainer: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: 'center',
  },
  savedStamp: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: T.type.heading2.size,
    lineHeight: T.type.heading2.lineHeight,
    color: T.color.list.bar.health, // jade-800 done stamp
    textAlign: 'center',
  },
  savedEcho: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: T.color.text.heading,
    textAlign: 'center',
    backgroundColor: T.color.surface.subtle,
    borderRadius: T.radius.md,
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
    backgroundColor: T.input.bg,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedSecondaryBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    color: T.color.text.primary,
  },
  savedPrimaryBtn: {
    height: 48,
    paddingHorizontal: 24,
    backgroundColor: T.button.primary.bg,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedPrimaryBtnText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    color: T.color.text.onDark,
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
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    backgroundColor: T.input.bg,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  numericInput: {
    flex: 1,
    fontFamily: T.type.bodyLarge.fontFamily, // tabular figures — Sarabun
    fontSize: 22,
    lineHeight: 28,
    color: T.color.text.heading,
    paddingVertical: 12,
  },
  numericInputHint: {
    // Hint state: keep ink colour (NEVER status/attention amber — capture-ui §4)
    color: T.color.text.heading,
  },
  unitLabel: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 16,
    lineHeight: 24,
    color: T.color.text.primary,
    marginLeft: 8,
  },
  // BP: systolic / diastolic row
  bpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    backgroundColor: T.input.bg,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  bpField: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 22,
    lineHeight: 28,
    color: T.color.text.heading,
    paddingVertical: 12,
    width: 70,
    textAlign: 'center',
  },
  bpSeparator: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 22,
    color: T.color.text.primary,
    paddingHorizontal: 4,
  },
  // Text input for swelling/lochia/symptom
  textInput: {
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 14,
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 16,
    lineHeight: 25,
    color: T.color.text.heading,
    backgroundColor: T.input.bg,
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
    color: T.color.text.primary, // ink/soft (explicitly NOT status/attention amber)
  },
  hintText: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 13,
    lineHeight: 19,
    color: T.color.text.primary, // ink/soft (capture-ui §4: never amber)
    flex: 1,
  },

  // ── Medication region styles ───────────────────────────────────────────────
  // INV-M4: name/dose VERBATIM; INV-M2: neutral styling for taken AND missed.

  /** Wrapper block for plan name + from-label + dose line. */
  medPlanBlock: {
    backgroundColor: T.input.bg,
    borderWidth: 1,
    borderColor: T.color.surface.divider,
    borderRadius: T.radius.md,
    padding: 14,
    gap: 2,
  },
  /** Plan name line — verbatim, semi-bold (INV-M4). */
  medPlanName: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: 16,
    lineHeight: 24,
    color: T.color.text.heading, // verbatim, never coloured (INV-M4)
  },
  /** "จากแผนยา" / "From plan" secondary label below the plan name. */
  medPlanFrom: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 13,
    lineHeight: 19,
    color: T.color.text.primary,
  },
  /** "ขนาด 1 เม็ด" dose line — verbatim (INV-M4). */
  medDose: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 14,
    lineHeight: 21,
    color: T.color.text.primary, // neutral, never coloured (INV-M4)
  },
  /**
   * Status section: label + chip row for taken / missed.
   * INV-M2: both chips use IDENTICAL chipSelected styling.
   * Missed is NEVER amber/attention — no shaming. (INV-M2 / AC-20)
   */
  medStatusSection: {
    gap: 6,
  },
  medStatusLabel: {
    fontFamily: T.type.caption.fontFamily,
    fontSize: 13,
    lineHeight: 19,
    color: T.color.text.primary,
  },
  /** Row containing the taken and missed chips (equal-weight flex row). */
  medStatusChips: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
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
    borderColor: T.color.surface.divider,
    backgroundColor: T.input.bg,
    minHeight: 48, // a11y ≥ 48dp (blocker #5)
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: T.color.surface.wash.roselle,
    borderColor: T.color.list.bar.pregnancy,
  },
  chipText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 14,
    lineHeight: 20,
    color: T.color.text.primary,
  },
  chipTextSelected: {
    fontFamily: T.type.heading2.fontFamily,
    color: T.color.text.primary,
  },
});

// ─── iOS Date picker sheet styles ─────────────────────────────────────────────

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: T.scrim.color,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: T.color.surface.base,
    borderTopLeftRadius: T.radius.lg,
    borderTopRightRadius: T.radius.lg,
    paddingBottom: 32,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.color.surface.divider,
  },
  cancelBtn: { minHeight: 48, justifyContent: 'center' as const },
  cancelText: {
    fontFamily: T.type.bodyLarge.fontFamily,
    fontSize: 15,
    color: T.color.text.primary,
  },
  doneBtn: { minHeight: 48, justifyContent: 'center' as const },
  doneText: {
    fontFamily: T.type.heading2.fontFamily,
    fontSize: 15,
    color: T.color.accent.interactive,
  },
  picker: { alignSelf: 'center' as const },
});
