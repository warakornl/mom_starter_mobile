/**
 * medicationCaptureLogic.ts — Pure logic for the medication capture family.
 *
 * No React Native imports — all functions are pure and synchronously testable.
 *
 * Exports
 * ───────
 *   buildMedicationLogInput    — builds MedicationLogInput from form state
 *   buildMedicationEchoLine    — builds the live-preview echo EchoLine
 *   orchestrateMedicationSave  — consent-gating orchestration (skip/gate/persist)
 *   MedicationSaveOrchestrationResult — discriminated union for the three actions
 *
 * Key invariants enforced here:
 *   FLAG-1  occurrenceTime is floating-civil YYYY-MM-DDTHH:mm (no zone, no Z).
 *   INV-M1  No grade/verdict words are ever emitted in any echo text (AC-20).
 *   INV-M2  taken and missed produce IDENTICAL structural output — no shaming.
 *   INV-M4  Plan name and dose are shown VERBATIM — never translated or parsed.
 *
 * Security:
 *   SD-2/SD-5 — name/dose are opaque base64 ciphertext; only the DECODED form
 *   is rendered verbatim in the echo. The raw base64 MUST NOT be logged.
 *   NEVER log note, occurrenceTime, or medicationPlanId (health data — SD-5).
 */

import { encodeFieldToBase64, buildLoggedAt, isSaveGatedByConsent } from './captureScreenLogic';
import type { MedicationLogInput } from '../sync/syncTypes';
import type { EchoLine } from './captureEcho';

// ─── Constants (shared with captureEcho.ts) ────────────────────────────────────

const LOG_MARK = '▪';
const SEP = '·';

// ─── buildMedicationLogInput ──────────────────────────────────────────────────

/**
 * Builds a MedicationLogInput for a save (create-only, immutable event — D3).
 *
 * Parameters
 * ----------
 * planId        — Plan UUID, or null/undefined for ad-hoc (no plan) logs.
 *                 Passed through as-is (null coerced from undefined).
 * status        — 'taken' | 'missed'. Both are valid; default on the form is 'taken'.
 * occurrenceTime — Floating-civil YYYY-MM-DDTHH:mm (FLAG-1). Caller responsible
 *                 for computing this via buildLoggedAt(dateCivil, timeStr).
 *                 Passed through verbatim — never zone-converted here.
 * noteText      — Raw user text. Empty/whitespace → null. Non-empty → base64-
 *                 encoded (opaque on wire; AES-GCM is carry-forward — D4).
 *
 * Security:
 *   NEVER log planId, occurrenceTime, or note (SD-5 MOTHER-health).
 *   encodeFieldToBase64 output must not be logged either.
 */
export function buildMedicationLogInput(
  planId: string | null | undefined,
  status: 'taken' | 'missed',
  occurrenceTime: string,
  noteText?: string | null,
): MedicationLogInput {
  const trimmedNote = noteText?.trim();
  return {
    medicationPlanId: planId ?? null,
    occurrenceTime,          // FLAG-1 — verbatim, no zone conversion
    status,
    note: trimmedNote ? encodeFieldToBase64(trimmedNote) : null,
  };
}

// ─── buildMedicationEchoLine ──────────────────────────────────────────────────

/**
 * Builds the live-preview echo line for the medication capture family.
 *
 * Format (capture-ui §3.1):
 *   ▪ {planName}[ {dose}] · {statusLabel} {time}
 *
 * Rules:
 *   - Plan name VERBATIM — never translated (INV-M4).
 *   - Dose appended verbatim when non-empty (space-separated).
 *   - Empty planName → placeholder (no "▪  ·" orphan).
 *   - taken and missed produce IDENTICAL structural output ({ type: 'text' }) —
 *     the ONLY difference is the status label text (INV-M2).
 *   - No grade/verdict/colour words are ever emitted (INV-M1 / AC-20).
 *
 * Parameters
 * ----------
 * planName    — decoded (UTF-8) plan name; pass '' for ad-hoc.
 * dose        — decoded (UTF-8) dose string, or null/undefined if absent.
 * status      — 'taken' | 'missed'. Label text supplied by caller (i18n).
 * time        — display time string, e.g. '08:05'.
 * takenLabel  — i18n label for 'taken' (e.g. 'กินแล้ว' / 'Taken').
 * missedLabel — i18n label for 'missed' (e.g. 'ไม่ได้กิน' / 'Not taken').
 */
export function buildMedicationEchoLine(
  planName: string,
  dose: string | null | undefined,
  status: 'taken' | 'missed',
  time: string,
  takenLabel: string,
  missedLabel: string,
): EchoLine {
  const name = planName.trim();
  if (!name) return { type: 'placeholder' };

  // INV-M2: both statuses use IDENTICAL structure — only the label text differs.
  // INV-M4: name and dose are verbatim — never modified.
  const statusLabel = status === 'taken' ? takenLabel : missedLabel;
  const dosePart = dose?.trim() ? ` ${dose.trim()}` : '';

  return {
    type: 'text',
    // INV-M1: no grade/verdict word emitted — statusLabel is caller-provided
    // and constrained to 'taken'/'missed' labels only. Echo text never says
    // "good", "bad", "missed ❌" etc. (AC-20 — no-interpretation boundary).
    value: `${LOG_MARK} ${name}${dosePart} ${SEP} ${statusLabel} ${time}`,
  };
}

// ─── orchestrateMedicationSave ────────────────────────────────────────────────

/**
 * Discriminated union returned by orchestrateMedicationSave.
 *
 *   skip    — Save was not enabled (nothing to do).
 *   gate    — Consent absent; caller shows JIT consent modal and stores
 *             payload in a ref so the grant handler can persist it.
 *   persist — Consent present; caller calls medicationLogSyncStore.addLog(payload).
 */
export type MedicationSaveOrchestrationResult =
  | { action: 'skip' }
  | { action: 'gate'; payload: MedicationLogInput }
  | { action: 'persist'; payload: MedicationLogInput };

/**
 * Consent-gating orchestration for medication save (medication-behavior §B.4).
 *
 * Mirrors orchestrateSave from captureScreenLogic but for the medication family.
 *
 * Flow
 * ────
 * 1. saveEnabled=false → action='skip'.
 * 2. Build occurrenceTime via buildLoggedAt (FLAG-1 floating-civil).
 * 3. Build MedicationLogInput (note base64-encoded if non-empty).
 * 4. !consentGranted → action='gate' + payload (JIT nudge path).
 * 5. consentGranted  → action='persist' + payload (fast path).
 *
 * Note: gate and persist payloads are IDENTICAL for the same form state.
 * This prevents the "stale-payload" bug where the modal grant path and the
 * direct path diverge due to captured closures.
 *
 * Security: NEVER log planId, occurrenceTime, or noteText (SD-5).
 * AC-22: server does NOT dedup (medicationPlanId, civil-day). Caller (Slice 3
 * reminder mark-done) is responsible for preventing duplicate log creation.
 */
export function orchestrateMedicationSave(params: {
  saveEnabled: boolean;
  consentGranted: boolean;
  planId: string | null | undefined;
  status: 'taken' | 'missed';
  dateCivil: string;
  timeStr: string;
  noteText?: string | null;
}): MedicationSaveOrchestrationResult {
  if (!params.saveEnabled) {
    return { action: 'skip' };
  }

  // FLAG-1 — floating-civil YYYY-MM-DDTHH:mm, no zone conversion.
  const occurrenceTime = buildLoggedAt(params.dateCivil, params.timeStr);

  const payload = buildMedicationLogInput(
    params.planId,
    params.status,
    occurrenceTime,
    params.noteText,
  );

  if (isSaveGatedByConsent(params.consentGranted)) {
    return { action: 'gate', payload };
  }
  return { action: 'persist', payload };
}
