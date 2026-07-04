/**
 * markDoneLogic.ts — Pure logic for the mark-done medication side-effect (Task 4).
 *
 * All functions are pure and synchronously testable (no React Native imports).
 *
 * Exports
 * ───────
 *   computeMarkDoneLogId         — deterministic uuidv5 log id from occurrence id (§3.2)
 *   splitScheduledLocalTime      — pre-split for byte-identical occurrenceTime (§3.6)
 *   buildMarkDoneMedicationPayload — orchestration wrapper (§3.1, §3.2, §3.6)
 *
 * Key invariants enforced here:
 *   MR-AC-7  occurrenceTime === scheduledLocalTime byte-for-byte (no drift).
 *   MR-AC-8  markDoneLogId = uuidv5("medication_taken", oid) — name FIRST (§3.2).
 *   MR-AC-9  Two distinct oids (BID/TID) → two distinct log ids (never collapse).
 *   INV-MR-3 The log is ALWAYS routed through orchestrateMedicationSave so the
 *             general_health consent gate is honoured without exception (§3.1).
 *
 * Security:
 *   NEVER log oid, scheduledLocalTime, sourceRefId, or any payload field (SD-5).
 *   These values are MOTHER-health data.
 */

import { v5 as uuidv5 } from 'uuid';
import {
  orchestrateMedicationSave,
  type MedicationSaveOrchestrationResult,
} from '../capture/medicationCaptureLogic';

// ─── computeMarkDoneLogId ─────────────────────────────────────────────────────

/**
 * Compute the deterministic mark-done log id (spec §3.2).
 *
 * Formula: uuidv5(name, namespace)
 *   name      = "medication_taken" (fixed string — the write provenance)
 *   namespace = oid (the occurrence's deterministic uuidv5 id — a valid UUID)
 *
 * ARG ORDER WARNING: the installed `uuid` lib is v5(name, namespace).
 *   - CORRECT:  uuidv5("medication_taken", oid)  ← name first, oid as namespace
 *   - WRONG:    uuidv5(oid, "medication_taken")   ← throws TypeError ("medication_taken"
 *               is not a valid UUID namespace, so this crashes at runtime)
 *
 * This deterministic id makes the mark-done write idempotent across taps AND
 * devices: the same oid always yields the same log id, so duplicate pushes are
 * collapsed by the server's immutable union-merge (D3/E7 — no backend change).
 *
 * @param oid  The deterministic uuidv5 occurrence id (from computeOccurrenceId).
 *             MUST be a valid UUID string (lowercase recommended).
 * @returns    Deterministic UUIDv5 string for the mark-done MedicationLog.
 */
export function computeMarkDoneLogId(oid: string): string {
  // name="medication_taken" FIRST; oid (a UUID) is the NAMESPACE — spec §3.2.
  return uuidv5('medication_taken', oid);
}

// ─── splitScheduledLocalTime ──────────────────────────────────────────────────

/**
 * Split "YYYY-MM-DDTHH:mm" into its constituent parts for verbatim round-trip.
 *
 * Purpose (spec §3.6 / MR-AC-7):
 *   The mark-done log's `occurrenceTime` MUST be byte-identical to the
 *   occurrence's `scheduledLocalTime`. If we let `orchestrateMedicationSave` rebuild
 *   the time from scratch, `buildLoggedAt(dateCivil, timeStr)` trivially returns
 *   `${dateCivil}T${timeStr}` — so pre-splitting the occurrence's own
 *   `scheduledLocalTime` and passing those parts verbatim guarantees:
 *     buildLoggedAt(dateCivil, timeStr) === scheduledLocalTime  (byte-exact, FLAG-1)
 *
 * @param scheduledLocalTime  Floating-civil "YYYY-MM-DDTHH:mm" from the expander.
 * @returns  { dateCivil: "YYYY-MM-DD", timeStr: "HH:mm" }
 */
export function splitScheduledLocalTime(scheduledLocalTime: string): {
  dateCivil: string;
  timeStr: string;
} {
  return {
    dateCivil: scheduledLocalTime.slice(0, 10),
    timeStr: scheduledLocalTime.slice(11, 16),
  };
}

// ─── buildMarkDoneMedicationPayload ──────────────────────────────────────────

/**
 * Input params for buildMarkDoneMedicationPayload.
 *
 * Security: NEVER log any of these fields (all health-adjacent — SD-5).
 */
export interface MarkDoneMedicationParams {
  /** Deterministic occurrence id — computeOccurrenceId(reminderId, scheduledLocalTime). */
  oid: string;
  /** "YYYY-MM-DDTHH:mm" floating-civil from the expander (FLAG-1). */
  scheduledLocalTime: string;
  /** reminder.sourceRefId — the medication plan UUID. */
  sourceRefId: string;
  /** Whether general_health consent is currently granted. */
  consentGranted: boolean;
}

/**
 * Build the deterministic log id + orchestration result for a medication mark-done.
 *
 * Implements spec §3.1 (mark-done side-effect), §3.2 (deterministic id),
 * and §3.6 (byte-identical occurrenceTime).
 *
 * Usage in the caller (handleOccurrenceAction):
 *   const { markDoneLogId, orchestrationResult } = buildMarkDoneMedicationPayload(params);
 *   if (orchestrationResult.action === 'persist') {
 *     medicationLogSyncStore.addLog(orchestrationResult.payload, markDoneLogId);
 *   } else if (orchestrationResult.action === 'gate') {
 *     // JIT consent nudge; hold markDoneLogId + payload until grant
 *   }
 *
 * @returns  markDoneLogId    — the deterministic id for this mark-done log.
 *           orchestrationResult — discriminated union (skip/gate/persist) from
 *                                 orchestrateMedicationSave.
 */
export function buildMarkDoneMedicationPayload(params: MarkDoneMedicationParams): {
  markDoneLogId: string;
  orchestrationResult: MedicationSaveOrchestrationResult;
} {
  const markDoneLogId = computeMarkDoneLogId(params.oid);

  // Pre-split scheduledLocalTime so buildLoggedAt re-composes it verbatim (MR-AC-7 / §3.6).
  const { dateCivil, timeStr } = splitScheduledLocalTime(params.scheduledLocalTime);

  // Route through orchestrateMedicationSave to honour the general_health consent gate
  // (INV-MR-3 — NEVER bypass this path for a mark-done taken log).
  const orchestrationResult = orchestrateMedicationSave({
    saveEnabled: true,
    consentGranted: params.consentGranted,
    planId: params.sourceRefId,
    status: 'taken',
    dateCivil,
    timeStr,
    noteText: null,
  });

  return { markDoneLogId, orchestrationResult };
}
