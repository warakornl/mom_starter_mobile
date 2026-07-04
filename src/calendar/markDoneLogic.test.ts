/**
 * markDoneLogic.test.ts — TDD RED phase for Task 4 (AC-17 + duplicate guard).
 *
 * Pure-logic tests (no React, no RN imports) for:
 *   1. computeMarkDoneLogId     — deterministic uuidv5 arg order (spec §3.2)
 *   2. splitScheduledLocalTime  — pre-split for byte-identical occurrenceTime (§3.6)
 *   3. buildMarkDoneMedicationPayload — orchestration: one log, consent gate, dedup
 *
 * Acceptance criteria asserted here:
 *   MR-AC-7  occurrenceTime byte-identical to scheduledLocalTime (no drift)
 *   MR-AC-8  id = uuidv5("medication_taken", oid) — name FIRST, oid as namespace
 *   MR-AC-9  BID/TID: two distinct oids → two distinct log ids (never collapse)
 *   MR-AC-10 non-medication → zero logs (guarded by reminderType branch in caller)
 *   INV-MR-3 log always via orchestrateMedicationSave → consent gate holds
 *   MR-E1    consent declined → action='gate', occurrence written (tested in caller)
 *   MR-E8    repeated taps → same markDoneLogId (idempotent by oid)
 *   MR-E10   twice-daily plan: two occurrences → two distinct log ids
 *
 * Security: all fixture UUIDs are synthetic — no real health data.
 */

import { v5 as uuidv5 } from 'uuid';
import { buildLoggedAt } from '../capture/captureScreenLogic';
import {
  computeMarkDoneLogId,
  splitScheduledLocalTime,
  buildMarkDoneMedicationPayload,
} from './markDoneLogic';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const REMINDER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLAN_ID     = 'bbbbbbbb-0000-4000-8000-000000000002';
const SCHED_AM    = '2026-07-04T08:00';
const SCHED_PM    = '2026-07-04T20:00';

// Pre-compute the deterministic occurrence ids (same formula as occurrenceId.ts)
// They are the NAMESPACE for the mark-done log id.
const OCCURRENCE_NAMESPACE = '4328078f-6339-4c38-a2ce-eabff6cbf387';
function occurrenceId(reminderId: string, slt: string): string {
  const name = `${reminderId.toLowerCase()}|${slt}`;
  return uuidv5(name, OCCURRENCE_NAMESPACE);
}
const OID_AM = occurrenceId(REMINDER_ID, SCHED_AM);
const OID_PM = occurrenceId(REMINDER_ID, SCHED_PM);

// ─── computeMarkDoneLogId (§3.2) ─────────────────────────────────────────────

describe('computeMarkDoneLogId (spec §3.2 — MR-AC-8)', () => {
  it('returns a valid uuid string', () => {
    const id = computeMarkDoneLogId(OID_AM);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('arg order is uuidv5("medication_taken", oid) — name FIRST, oid as namespace (MR-AC-8)', () => {
    // The correct call: name="medication_taken", namespace=oid
    const expected = uuidv5('medication_taken', OID_AM);
    expect(computeMarkDoneLogId(OID_AM)).toBe(expected);
  });

  it('is deterministic — same oid always yields same log id (MR-E8 repeated-tap dedup)', () => {
    expect(computeMarkDoneLogId(OID_AM)).toBe(computeMarkDoneLogId(OID_AM));
  });

  it('BID plan: two distinct oids yield TWO distinct log ids — never collapse (MR-E10 / MR-AC-9)', () => {
    const logIdAm = computeMarkDoneLogId(OID_AM);
    const logIdPm = computeMarkDoneLogId(OID_PM);
    expect(logIdAm).not.toBe(logIdPm);
  });

  it('arg-order guard: uuidv5(oid, "medication_taken") produces a DIFFERENT id — wrong order throws or differs', () => {
    // The WRONG call: uuidv5(oid, "medication_taken") — "medication_taken" is not a valid UUID namespace
    // In the uuid library this throws a TypeError; we verify the correct call does NOT equal the wrong order.
    // We use a try/catch to handle the throw gracefully in the test (we just check correct != wrong or throws).
    let wrongOrderId: string | null = null;
    try {
      wrongOrderId = uuidv5(OID_AM, 'medication_taken');
    } catch {
      wrongOrderId = null; // expected: "medication_taken" is not a valid UUID namespace → throws
    }
    const correctId = computeMarkDoneLogId(OID_AM);
    // Either it throws (wrongOrderId===null) or it produces a different id
    expect(correctId).not.toBe(wrongOrderId);
  });
});

// ─── splitScheduledLocalTime (§3.6) ──────────────────────────────────────────

describe('splitScheduledLocalTime (spec §3.6 — MR-AC-7)', () => {
  it('splits "YYYY-MM-DDTHH:mm" into dateCivil and timeStr', () => {
    const result = splitScheduledLocalTime('2026-07-04T08:00');
    expect(result).toEqual({ dateCivil: '2026-07-04', timeStr: '08:00' });
  });

  it('works for PM time', () => {
    const result = splitScheduledLocalTime('2026-07-04T20:00');
    expect(result).toEqual({ dateCivil: '2026-07-04', timeStr: '20:00' });
  });

  it('round-trip: buildLoggedAt(dateCivil, timeStr) === scheduledLocalTime byte-for-byte (MR-AC-7)', () => {
    const slt = '2026-07-04T08:00';
    const { dateCivil, timeStr } = splitScheduledLocalTime(slt);
    // buildLoggedAt simply returns `${dateCivil}T${timeStr}` — byte-identical
    expect(buildLoggedAt(dateCivil, timeStr)).toBe(slt);
  });

  it('round-trip for PM time — byte-identical (MR-AC-7)', () => {
    const slt = SCHED_PM;
    const { dateCivil, timeStr } = splitScheduledLocalTime(slt);
    expect(buildLoggedAt(dateCivil, timeStr)).toBe(slt);
  });
});

// ─── buildMarkDoneMedicationPayload (§3.1 + §3.2 + §3.6) ─────────────────────

describe('buildMarkDoneMedicationPayload (spec §3.1 / §3.2 / §3.6 — MR-AC-7/8)', () => {
  const baseParams = {
    oid: OID_AM,
    scheduledLocalTime: SCHED_AM,
    sourceRefId: PLAN_ID,
    consentGranted: true,
  };

  it('returns markDoneLogId equal to uuidv5("medication_taken", oid)', () => {
    const { markDoneLogId } = buildMarkDoneMedicationPayload(baseParams);
    expect(markDoneLogId).toBe(uuidv5('medication_taken', OID_AM));
  });

  it('with consent granted → action="persist" (fast path)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload(baseParams);
    expect(orchestrationResult.action).toBe('persist');
  });

  it('persist payload has status=taken (AC-17)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload(baseParams);
    if (orchestrationResult.action !== 'persist') throw new Error('expected persist');
    expect(orchestrationResult.payload.status).toBe('taken');
  });

  it('persist payload medicationPlanId === sourceRefId (AC-17)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload(baseParams);
    if (orchestrationResult.action !== 'persist') throw new Error('expected persist');
    expect(orchestrationResult.payload.medicationPlanId).toBe(PLAN_ID);
  });

  it('persist payload occurrenceTime is byte-identical to scheduledLocalTime (MR-AC-7 / §3.6)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload(baseParams);
    if (orchestrationResult.action !== 'persist') throw new Error('expected persist');
    // Must be the exact same string, not a re-formatted version
    expect(orchestrationResult.payload.occurrenceTime).toBe(SCHED_AM);
  });

  it('persist payload note is null (no auto-note on mark-done)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload(baseParams);
    if (orchestrationResult.action !== 'persist') throw new Error('expected persist');
    expect(orchestrationResult.payload.note).toBeNull();
  });

  it('with consent declined → action="gate" (INV-MR-3 / MR-E1)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload({
      ...baseParams,
      consentGranted: false,
    });
    expect(orchestrationResult.action).toBe('gate');
  });

  it('gate payload has the same structure as persist (held-value posture, MR-E1)', () => {
    const { orchestrationResult } = buildMarkDoneMedicationPayload({
      ...baseParams,
      consentGranted: false,
    });
    if (orchestrationResult.action !== 'gate') throw new Error('expected gate');
    expect(orchestrationResult.payload.status).toBe('taken');
    expect(orchestrationResult.payload.medicationPlanId).toBe(PLAN_ID);
    expect(orchestrationResult.payload.occurrenceTime).toBe(SCHED_AM);
  });

  it('is deterministic: repeated calls with same params yield same markDoneLogId (MR-E8)', () => {
    const first  = buildMarkDoneMedicationPayload(baseParams);
    const second = buildMarkDoneMedicationPayload(baseParams);
    expect(first.markDoneLogId).toBe(second.markDoneLogId);
  });

  // MR-E10 / MR-AC-9: BID plan same-day two occurrences → two distinct log ids
  it('BID plan: AM and PM oids yield two distinct markDoneLogIds — never collapse (MR-AC-9)', () => {
    const am = buildMarkDoneMedicationPayload({ ...baseParams, oid: OID_AM, scheduledLocalTime: SCHED_AM });
    const pm = buildMarkDoneMedicationPayload({ ...baseParams, oid: OID_PM, scheduledLocalTime: SCHED_PM });
    expect(am.markDoneLogId).not.toBe(pm.markDoneLogId);
  });

  it('BID plan: AM and PM occurrenceTime values are distinct and byte-identical to their inputs (MR-AC-7/9)', () => {
    const am = buildMarkDoneMedicationPayload({ ...baseParams, oid: OID_AM, scheduledLocalTime: SCHED_AM });
    const pm = buildMarkDoneMedicationPayload({ ...baseParams, oid: OID_PM, scheduledLocalTime: SCHED_PM });
    if (am.orchestrationResult.action !== 'persist') throw new Error('expected persist');
    if (pm.orchestrationResult.action !== 'persist') throw new Error('expected persist');
    expect(am.orchestrationResult.payload.occurrenceTime).toBe(SCHED_AM);
    expect(pm.orchestrationResult.payload.occurrenceTime).toBe(SCHED_PM);
  });
});
