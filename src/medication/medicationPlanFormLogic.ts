/**
 * medicationPlanFormLogic — pure business logic for MedicationPlanFormSheet.
 *
 * Extracted for unit-testability; the form sheet imports and wires these.
 *
 * Implements:
 *  - buildScheduleRuleFromPicker: convert picker state → MedicationScheduleRule
 *    (FLAG-4 grammar; reuses validateRecurrenceRule for base checks)
 *  - buildMedicationPlanInput: base64 name/dose + scheduleRule + active
 *  - validateMedSchedule: typo-guard validation only (name, time, interval)
 *  - isMedSaveEnabled: aggregate Save-button predicate
 *  - orchestrateMedSave: consent-gated orchestration (mirrors captureScreenLogic
 *    orchestrateSave pattern — stale-callback-safe, holds payload in ref)
 *
 * FLAG-4 grammar reuse:
 *   The medication schedule grammar is a strict subset of the reminder
 *   recurrence grammar (reminderFormValidator.ts). It excludes 'weekly'/byDay
 *   and constrains interval >= 2 (vs >= 1 for reminders). This module reuses
 *   validateRecurrenceRule for the base grammar check, then layers the
 *   medication-specific interval >= 2 guard on top.
 *
 * Security:
 *  - NEVER log name or dose — opaque base64 ciphertext (SD-2/SD-5).
 *  - encodeFieldToBase64 output must not be logged.
 *  - scheduleRule must not be logged if it reveals drug timing (SD-5).
 */

import type { MedicationPlanInput, MedicationScheduleRule } from '../sync/syncTypes';

// ─── Toast variant (shared across list screen and this module) ────────────────
export type ToastVariant = 'saved' | 'savedLocalOnly' | 'deactivated' | 'deleted' | 'error';
import { encodeFieldToBase64 } from '../capture/captureScreenLogic';
import { validateRecurrenceRule } from '../calendar/reminderFormValidator';

// ─── Picker state ─────────────────────────────────────────────────────────────

/**
 * State emitted by the schedule sub-picker (3 chips: Daily / Every N days / One time).
 *
 * Maps 1:1 to the three chips in medication-plan-ui.md §5.3.
 * Passed to buildScheduleRuleFromPicker to produce a MedicationScheduleRule.
 *
 * interval is only meaningful for 'every_n_days'; the stepper clamps at ≥ 2.
 * timesOfDay is only meaningful for 'daily' and 'every_n_days'.
 * startTime is the single time used for 'one_off'.
 */
export interface SchedulePickerState {
  freq: 'daily' | 'every_n_days' | 'one_off';
  /** YYYY-MM-DD day-0 anchor (defaults to today; backdatable). */
  startDate: string;
  /** HH:mm — used as the single fire time for one_off. */
  startTime: string;
  /** HH:mm[] — times for daily / every_n_days; each displayed as a removable chip. */
  timesOfDay: string[];
  /** Integer ≥ 2, for every_n_days only; stepper clamps at min 2. */
  interval: number;
}

// ─── Validation errors ────────────────────────────────────────────────────────

/**
 * Field-level validation error set for the medication plan form.
 *
 * Each string is an i18n message key (or the empty string when the field is valid).
 * The form renders errors only after a Save attempt (typo-guard, never clinical).
 */
export interface MedValidationErrors {
  /** Non-empty when name is blank (typo-guard: "add a name"). */
  nameError: string;
  /** Non-empty when daily/every_n_days has no timesOfDay entry. */
  timeError: string;
  /** Non-empty when every_n_days interval < 2 (medication-specific rule). */
  intervalError: string;
}

// ─── Save orchestration result ────────────────────────────────────────────────

/**
 * Result of orchestrateMedSave — tells the caller what to do next.
 *
 *  skip    — saveEnabled was false; nothing to do.
 *  gate    — general_health consent absent; payload is the freshly-built
 *            MedicationPlanInput. Caller stores it in a ref and persists it
 *            after consent is granted (medication-plan-ui.md §7.2 pattern:
 *            "values held → Save completes on Grant").
 *  persist — consent already granted; caller should call
 *            store.addPlan(payload) or store.updatePlan(id, payload).
 */
export type MedSaveOrchestrationResult =
  | { action: 'skip' }
  | { action: 'gate'; payload: MedicationPlanInput }
  | { action: 'persist'; payload: MedicationPlanInput };

// ─── buildScheduleRuleFromPicker ──────────────────────────────────────────────

/**
 * Convert picker state → MedicationScheduleRule (FLAG-4 grammar).
 *
 * Differences from RecurrenceRuleWire:
 *   - No 'weekly' freq, no byDay.
 *   - startAt is FOLDED INTO the rule (no separate parent startAt column).
 *   - interval >= 2 (enforced by the stepper UI; caller guards before calling).
 *   - until is omitted in MVP (deferred post-MVP; grammar already supports it).
 *
 * For daily / every_n_days:
 *   startAt = `${startDate}T${timesOfDay[0]}` (first ascending time → day-0 anchor)
 *   timesOfDay = sorted ascending copy of all times
 *
 * For one_off:
 *   startAt = `${startDate}T${startTime}`
 *   timesOfDay absent; interval absent.
 *
 * Security: do NOT log the returned rule (SD-5 — timing may infer drug class).
 */
export function buildScheduleRuleFromPicker(state: SchedulePickerState): MedicationScheduleRule {
  const { freq, startDate, startTime, timesOfDay, interval } = state;

  if (freq === 'one_off') {
    return {
      freq: 'one_off',
      startAt: `${startDate}T${startTime}`,
    };
  }

  // Sort ascending (canonical form required by FLAG-4 grammar)
  const sortedTimes = [...timesOfDay].sort();
  const firstTime = sortedTimes[0] ?? '08:00';
  const startAt = `${startDate}T${firstTime}`;

  if (freq === 'daily') {
    return {
      freq: 'daily',
      startAt,
      timesOfDay: sortedTimes,
    };
  }

  // every_n_days — interval >= 2 (validated by stepper; included unconditionally)
  return {
    freq: 'every_n_days',
    startAt,
    timesOfDay: sortedTimes,
    interval,
  };
}

// ─── buildMedicationPlanInput ─────────────────────────────────────────────────

/**
 * Build a MedicationPlanInput from raw form values.
 *
 * - name and dose are base64-encoded (opaque, SD-2 / D4).
 * - dose is omitted (null) when blank.
 * - scheduleRule is null for PRN (ad-hoc) plans.
 * - active reflects the toggle state.
 *
 * Security: NEVER log name, dose, or the returned input (SD-2 / SD-5).
 *
 * @param name        Verbatim, user-typed medication name (plaintext)
 * @param dose        Verbatim, user-typed dose text (plaintext; '' = absent)
 * @param pickerState Schedule picker state; null = PRN / ad-hoc
 * @param active      Whether the plan is currently active
 */
export function buildMedicationPlanInput(
  name: string,
  dose: string,
  pickerState: SchedulePickerState | null,
  active: boolean,
): MedicationPlanInput {
  const trimmedDose = dose.trim();

  return {
    // Security: base64-encoding is the MVP ciphertext posture (K-7 carry-forward)
    name: encodeFieldToBase64(name.trim()),
    dose: trimmedDose ? encodeFieldToBase64(trimmedDose) : null,
    scheduleRule: pickerState ? buildScheduleRuleFromPicker(pickerState) : null,
    active,
  };
}

// ─── validateMedSchedule — typo-guard only ────────────────────────────────────

/**
 * Validate the medication plan form fields.
 *
 * Returns a MedValidationErrors object; each field is '' when valid, or an
 * opaque error-token string when invalid (caller maps to i18n key for display).
 *
 * Uses FLAG-4 validateRecurrenceRule as the base grammar check, then layers
 * the medication-specific interval >= 2 guard (RULING 7.1).
 *
 * TONE: typo-guard only. Returns "add a name", "pick a time",
 * "must be 2 days or more" — never clinical or judgmental copy.
 *
 * @param name        Raw (non-encoded) medication name from the form
 * @param pickerState Current schedule picker state; null = PRN (no schedule errors)
 */
export function validateMedSchedule(
  name: string,
  pickerState: SchedulePickerState | null,
): MedValidationErrors {
  const errors: MedValidationErrors = {
    nameError: '',
    timeError: '',
    intervalError: '',
  };

  // Name: required (typo-guard: "add a name for this medication")
  if (!name.trim()) {
    errors.nameError = 'medication.errorNameRequired';
  }

  // No schedule (PRN) → no schedule errors
  if (!pickerState) return errors;

  const { freq, timesOfDay, interval, startDate, startTime } = pickerState;

  // Build startAt for the FLAG-4 validator
  const firstTime = [...timesOfDay].sort()[0] ?? startTime;
  const startAt =
    freq === 'one_off'
      ? `${startDate}T${startTime}`
      : `${startDate}T${firstTime}`;

  // Delegate base grammar checking to the shared FLAG-4 validator (no byDay for medication)
  const ruleErrors = validateRecurrenceRule(
    freq,
    freq === 'every_n_days' ? String(interval) : '1',
    freq === 'one_off' ? [] : timesOfDay,
    '', // until omitted in MVP
    startAt,
    [], // byDay forbidden for medication
  );

  for (const err of ruleErrors) {
    if (err.field === 'timesOfDay') {
      errors.timeError = 'medication.errorTimeRequired';
    }
    // interval errors from FLAG-4 (covers < 1 case)
    if (err.field === 'interval') {
      errors.intervalError = 'medication.errorIntervalMin';
    }
  }

  // Medication-specific: interval must be >= 2 for every_n_days
  // (FLAG-4 allows >= 1; medication grammar requires >= 2 per RULING 7.1)
  if (freq === 'every_n_days' && Number.isInteger(interval) && interval < 2) {
    errors.intervalError = 'medication.errorIntervalMin';
  }

  return errors;
}

// ─── isMedSaveEnabled ─────────────────────────────────────────────────────────

/**
 * Returns true when all required form fields are in a storable state.
 *
 * Per medication-plan-ui.md §5.6:
 *   - Save disabled until (a) name is non-empty AND
 *     (b) at least one time is set (for daily/every_n_days) OR
 *         a valid date+time is set (for one_off).
 *   - For every_n_days: interval must also be >= 2.
 *   - PRN (null picker): name is the only required field.
 *
 * @param name        Raw (non-encoded) medication name
 * @param pickerState Current schedule picker state; null = PRN
 */
export function isMedSaveEnabled(
  name: string,
  pickerState: SchedulePickerState | null,
): boolean {
  if (!name.trim()) return false;

  // PRN plan: name is sufficient
  if (!pickerState) return true;

  const { freq, timesOfDay, interval } = pickerState;

  if (freq === 'daily' || freq === 'every_n_days') {
    if (!timesOfDay || timesOfDay.length === 0) return false;
    if (freq === 'every_n_days' && (!Number.isInteger(interval) || interval < 2)) {
      return false;
    }
  }

  // one_off: startDate + startTime always have a value (defaults to today + 08:00)
  return true;
}

// ─── orchestrateMedSave ───────────────────────────────────────────────────────

/**
 * Pure orchestration for the medication plan Save action.
 *
 * Builds the MedicationPlanInput from CURRENT form values (not a memoised
 * snapshot), then decides the action based on consent state.
 *
 * This avoids the stale-callback bug class from Slice 1: the payload is built
 * fresh from the live params passed in, and the caller chooses to persist it
 * immediately (persist path) or store it in a pendingPayloadRef for later
 * (gate path → grant → re-execute with same live form state).
 *
 * Mirror of orchestrateSave in captureScreenLogic.ts but for MedicationPlanInput.
 *
 * Security: NEVER log any param value (SD-2/SD-5 — health data).
 *
 * @param params.saveEnabled     True when all required fields are filled
 * @param params.consentGranted  True when general_health is granted
 * @param params.name            Raw medication name (plaintext)
 * @param params.dose            Raw dose text (plaintext; '' = absent)
 * @param params.pickerState     Schedule picker state; null = PRN
 * @param params.active          Active toggle state
 */
// ─── resolvePendingSave ───────────────────────────────────────────────────────

/**
 * Pure orchestration for the useFocusEffect pending-save path.
 *
 * Extracted so it can be unit-tested without React hooks or store state.
 * The caller (MedicationPlanListScreen) holds pendingPayloadRef and
 * pendingEditIdRef; this function decides whether to consume them.
 *
 * Returns:
 *  hold         — nothing to do (no payload, or consent not yet granted).
 *                 Caller must NOT clear refs (payload is still pending).
 *  persist-add  — call store.addPlan(payload) then show toast.
 *  persist-edit — call store.updatePlan(editId, payload) then show toast.
 *
 * The correct toast variant is driven by cloudGranted:
 *  true  → 'saved'          (cloud_storage granted — will sync)
 *  false → 'savedLocalOnly' (local-only save; matches direct save path §7.2)
 *
 * Security: NEVER log any argument (SD-2/SD-5 — health data).
 */
export interface ResolvePendingSaveResult {
  action: 'persist-add' | 'persist-edit' | 'hold';
  toast?: ToastVariant;
}

export function resolvePendingSave(
  pendingPayload: MedicationPlanInput | null,
  pendingEditId: string | null,
  consentGranted: boolean,
  cloudGranted: boolean,
): ResolvePendingSaveResult {
  // No pending payload — nothing to resolve
  if (!pendingPayload) return { action: 'hold' };

  // Consent not yet granted — keep holding (user may still grant)
  if (!consentGranted) return { action: 'hold' };

  // Consent granted — determine add vs edit path and the correct toast
  const toast: ToastVariant = cloudGranted ? 'saved' : 'savedLocalOnly';

  if (pendingEditId) {
    return { action: 'persist-edit', toast };
  }
  return { action: 'persist-add', toast };
}

// ─── orchestrateMedSave ───────────────────────────────────────────────────────

export function orchestrateMedSave(params: {
  saveEnabled: boolean;
  consentGranted: boolean;
  name: string;
  dose: string;
  pickerState: SchedulePickerState | null;
  active: boolean;
}): MedSaveOrchestrationResult {
  if (!params.saveEnabled) return { action: 'skip' };

  // Build payload from CURRENT params — no stale closure
  const payload = buildMedicationPlanInput(
    params.name,
    params.dose,
    params.pickerState,
    params.active,
  );

  // general_health gate (medication-plan-ui.md §7.2)
  if (!params.consentGranted) {
    return { action: 'gate', payload };
  }

  return { action: 'persist', payload };
}
