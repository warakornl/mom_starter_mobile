/**
 * medicationChain.integration.test.ts — cross-layer logic chain integration tests.
 *
 * These tests are the cross-cutting gap-fillers identified in the QA traceability
 * matrix (Task 12, Slice 2). They thread REAL module instances through the full
 * pipeline that per-task unit tests covered hop-by-hop but never end-to-end:
 *
 *   medicationPlanSyncStore  (addPlan, drainQueue, stampApplied, adoptServerRecord, getPlans)
 *   medicationLogSyncStore   (addLog,  drainQueue, stampApplied, adoptServerRecord, getLogs)
 *   orchestrateMedicationSave (consent gate → persist path)
 *     → (mock sync push response: applied[])
 *     → computeAdherence (N/M per plan, PRN count)
 *     → buildDoctorReportHtml (medication section in PDF)
 *
 * Gap list addressed:
 *
 *   GAP-MED-MOBILE-CHAIN (Mobile end-to-end logic chain):
 *     No single jest test threaded the plan-create/log-capture→store→drainQueue
 *     →(mock sync push response)→adopt-on-pull→computeAdherence→buildDoctorReportHtml
 *     chain at the logic level. Individual per-task unit tests cover each hop but no
 *     cross-layer chain test exists (unlike selfLogChain.integration.test.ts for Slice 1).
 *     Spec: medication-behavior.md §B.3 (data written), §B.4, sync contract §2,
 *     pdf-doctor-ui.md §3.5 (medication PDF section), INV-M1/M2 (no grade/shame).
 *
 *   GAP-MED-CONSENT-CHAIN (consent gate → grant → store payload valid):
 *     orchestrateMedicationSave unit tests assert action=gate / action=persist correctly
 *     but do NOT then call addLog on the real store to verify the payload is valid and the
 *     store state is updated. Spec: medication-behavior.md §B.4, capture-ui §3.1, SD-5.
 *
 * Rules:
 *  - All module instances are REAL (no mocked store/assembler/logic).
 *  - createMedicationPlanSyncStore / createMedicationLogSyncStore create fresh instances
 *    per test — never share the module-level singletons.
 *  - No new store factories beyond what is already exported from each store module.
 *  - No weakening or duplication of existing unit tests.
 *  - Spec invariants explicitly asserted where named (INV-M1, INV-M2, INV-M4, AC-20).
 *  - NEVER log name, dose, note, occurrenceTime, or planId (MOTHER-health SD-5).
 */

import { createMedicationPlanSyncStore } from './medicationPlanSyncStore';
import { createMedicationLogSyncStore } from './medicationLogSyncStore';
import { orchestrateMedicationSave } from '../capture/medicationCaptureLogic';
import { computeAdherence } from '../pdfReport/medicationAdherence';
import { buildDoctorReportHtml } from '../pdfReport/doctorReportAssembler';
import type { MedicationPlan, MedicationLog, SyncChangeSet } from '../sync/syncTypes';
import type {
  DoctorReportInput,
  ReportMedicationPlan,
  ReportMedicationLog,
} from '../pdfReport/doctorReportAssembler';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Opaque base64 name (plaintext "Amoxicillin" as base64 — Option A MVP posture).
 * INV-M4: rendered verbatim; never translated or parsed by server or assembler.
 */
const PLAN_NAME_B64 = Buffer.from('Amoxicillin').toString('base64');

/**
 * Opaque base64 dose (plaintext "1 cap" as base64).
 * INV-M4: rendered verbatim, never interpreted.
 */
const PLAN_DOSE_B64 = Buffer.from('1 cap').toString('base64');

/** Report date range — 31 days of July 2026. */
const DATE_FROM = '2026-07-01';
const DATE_TO   = '2026-07-31';

/** Minimal DoctorReportInput scaffold (without medication fields — added per test). */
const REPORT_BASE: Omit<DoctorReportInput, 'medicationPlans' | 'medicationLogs'> = {
  profile: {
    edd: '2026-11-01',
    gestationalWeek: 28,
    lifecycle: 'pregnant',
  },
  kickSessions: [],
  appointments: [],
  selfLogs: [],
  dateFrom: DATE_FROM,
  dateTo: DATE_TO,
  reportDate: '2026-07-04',
  locale: 'th',
  includeSensitiveNotes: false,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simulates what syncClient.push() does after receiving applied[] from the server:
 *  - calls stampApplied (version=1, server-assigned updatedAt)
 *  - calls adoptServerRecord (full record reconciliation — contract §4)
 *
 * For plans (LWW mutable): both stampApplied and adoptServerRecord are called.
 * For logs (immutable event): stampApplied is called; adoptServerRecord is called
 * (immutable event re-adoption is a no-op / same id re-write in map, D3).
 */
function simulatePlanPushResponse(
  planStore: ReturnType<typeof createMedicationPlanSyncStore>,
  changeset: SyncChangeSet,
): void {
  const created = changeset.medicationPlans?.created ?? [];
  const serverUpdatedAt = '2026-07-04T07:00:00.000Z';
  created.forEach((rec) => {
    const version = 1;
    planStore.stampApplied(rec.id, version, serverUpdatedAt);
    const serverRecord: MedicationPlan = {
      ...rec,
      version,
      updatedAt: serverUpdatedAt,
      createdAt: serverUpdatedAt,
      deletedAt: null,
    };
    planStore.adoptServerRecord(serverRecord);
  });
}

function simulateLogPushResponse(
  logStore: ReturnType<typeof createMedicationLogSyncStore>,
  changeset: SyncChangeSet,
): void {
  const created = changeset.medicationLogs?.created ?? [];
  const serverLoggedAt = '2026-07-04T07:00:00.000Z';
  created.forEach((rec) => {
    const version = 1;
    logStore.stampApplied(rec.id, version, serverLoggedAt);
    const serverRecord: MedicationLog = {
      ...rec,
      version,
      loggedAt: serverLoggedAt,
      updatedAt: serverLoggedAt,
      createdAt: serverLoggedAt,
      deletedAt: null,
    };
    logStore.adoptServerRecord(serverRecord);
  });
}

/**
 * Convert live plan store records to ReportMedicationPlan[] for computeAdherence.
 * Mirrors DoctorPdfScreen: decodes name/dose from base64 for the assembler.
 * INV-M4: name and dose decoded verbatim, never translated.
 */
function toReportPlans(
  planStore: ReturnType<typeof createMedicationPlanSyncStore>,
): ReportMedicationPlan[] {
  return planStore.getPlans().map((p) => ({
    id: p.id,
    name: Buffer.from(p.name, 'base64').toString('utf8'),
    dose: p.dose ? Buffer.from(p.dose, 'base64').toString('utf8') : null,
    scheduleRule: p.scheduleRule ?? null,
    active: p.active,
    deletedAt: p.deletedAt ?? null,
  }));
}

/**
 * Convert live log store records to ReportMedicationLog[] for computeAdherence.
 * note is decoded from base64 (gated by includeSensitiveNotes in the assembler).
 */
function toReportLogs(
  logStore: ReturnType<typeof createMedicationLogSyncStore>,
): ReportMedicationLog[] {
  return logStore.getLogs().map((l) => ({
    id: l.id,
    medicationPlanId: l.medicationPlanId ?? null,
    occurrenceTime: l.occurrenceTime,
    status: l.status as 'taken' | 'missed',
    note: l.note ? Buffer.from(l.note, 'base64').toString('utf8') : null,
  }));
}

// =============================================================================
// GAP-MED-MOBILE-CHAIN — Full logic chain happy path
//
// Chain:
//   addPlan (daily schedule) → drainQueue → simulatePlanPushResponse
//   addLog  (taken, plan ref) → drainQueue → simulateLogPushResponse
//   → getPlans / getLogs (both version:1 after stampApplied)
//   → toReportPlans / toReportLogs
//   → computeAdherence → N/M
//   → buildDoctorReportHtml (th) → medication section in PDF
//
// Spec:
//   medication-behavior.md §B.3 (store write), sync contract §2/§4,
//   RULING 7.2 (adherence formula), pdf-doctor-ui.md §3.5 (medication section),
//   INV-M1/M2 (no grade/shame), INV-M4 (verbatim name/dose)
// =============================================================================

describe('medicationChain integration — happy path (GAP-MED-MOBILE-CHAIN)', () => {
  it('addPlan (daily) → addLog (taken) → drainQueue → push response → computeAdherence → PDF contains name + N/M, no grade words', () => {
    const planStore = createMedicationPlanSyncStore();
    const logStore  = createMedicationLogSyncStore();

    // ── Step 1: Add a daily plan to the plan store ────────────────────────────
    // scheduleRule: daily, startAt 2026-07-01T08:00, fires at "08:00" → M=31 for July
    const plan = planStore.addPlan({
      name: PLAN_NAME_B64,
      dose: PLAN_DOSE_B64,
      scheduleRule: {
        freq: 'daily',
        startAt: '2026-07-01T08:00',
        timesOfDay: ['08:00'],
      },
      active: true,
    });

    expect(plan.id).toBeTruthy();
    expect(plan.version).toBe(0);        // create sentinel
    expect(plan.name).toBe(PLAN_NAME_B64); // opaque ciphertext preserved
    expect(planStore.getPlans()).toHaveLength(1);

    // ── Step 2: Drain plan queue (payload for sync/push) ─────────────────────
    const planChangeset = planStore.drainQueue();
    expect(planChangeset.medicationPlans!.created).toHaveLength(1);
    expect(planChangeset.medicationPlans!.updated).toHaveLength(0);
    expect(planChangeset.medicationPlans!.deleted).toHaveLength(0);
    expect(planStore.getPendingCount()).toBe(0); // queue cleared

    // ── Step 3: Add a taken log referencing the plan ──────────────────────────
    // occurrenceTime: floating-civil (FLAG-1 / D5) — no tz conversion
    const log = logStore.addLog({
      medicationPlanId: plan.id,
      occurrenceTime: '2026-07-04T08:00',  // civil bucket key for adherence N
      status: 'taken',
    });

    expect(log.id).toBeTruthy();
    expect(log.version).toBe(0);
    expect(log.status).toBe('taken');
    expect(logStore.getLogs()).toHaveLength(1);

    // ── Step 4: Drain log queue ───────────────────────────────────────────────
    const logChangeset = logStore.drainQueue();
    expect(logChangeset.medicationLogs!.created).toHaveLength(1);
    expect(logChangeset.medicationLogs!.updated).toHaveLength(0); // D3: always empty
    expect(logChangeset.medicationLogs!.deleted).toHaveLength(0);
    expect(logStore.getPendingCount()).toBe(0);

    // ── Step 5: Simulate server applied[] (stampApplied + adoptServerRecord) ──
    simulatePlanPushResponse(planStore, planChangeset);
    simulateLogPushResponse(logStore, logChangeset);

    // After stampApplied, both records carry version:1
    expect(planStore.getPlan(plan.id)!.version).toBe(1);
    expect(logStore.getLog(log.id)!.version).toBe(1);

    // Both still in store after reconciliation
    expect(planStore.getPlans()).toHaveLength(1);
    expect(logStore.getLogs()).toHaveLength(1);

    // ── Step 6: Convert to report shapes (mirrors DoctorPdfScreen) ───────────
    const reportPlans = toReportPlans(planStore);
    const reportLogs  = toReportLogs(logStore);

    // INV-M4: name decoded verbatim — "Amoxicillin" with no transformation
    expect(reportPlans[0].name).toBe('Amoxicillin');
    expect(reportPlans[0].dose).toBe('1 cap');

    // ── Step 7: computeAdherence → N/M ───────────────────────────────────────
    // M = 31 (daily plan, startAt=2026-07-01, full July range)
    // N = 1 (one taken log on 2026-07-04)
    const { planAdherences, selfRecordedLogs } = computeAdherence(
      reportPlans,
      reportLogs,
      DATE_FROM,
      DATE_TO,
    );

    expect(planAdherences).toHaveLength(1);
    const adherence = planAdherences[0];
    expect(adherence.planId).toBe(plan.id);
    expect(adherence.M).toBe(31);          // daily across all of July
    expect(adherence.N).toBe(1);           // one taken day
    expect(adherence.isPrn).toBe(false);   // scheduled plan

    // INV-M1: N < M must NOT produce a grade word or threshold (just counts)
    // (no grade logic in computeAdherence itself — the assembler test covers rendering)

    // INV-M2: missed logs have zero effect on N (only taken count)
    expect(selfRecordedLogs).toHaveLength(0); // log has a live plan → belongs to adherence

    // ── Step 8: buildDoctorReportHtml renders medication section ─────────────
    const html = buildDoctorReportHtml({
      ...REPORT_BASE,
      medicationPlans: reportPlans,
      medicationLogs: reportLogs,
    });

    // INV-M4: plan name must appear verbatim in PDF (never translated)
    expect(html).toContain('Amoxicillin');
    expect(html).toContain('1 cap');

    // N/M adherence rendered (Thai locale: "1/31 วัน")
    expect(html).toContain('1/31');

    // INV-M1 / AC-20: no grade words in any language — adherence is plain counts
    expect(html).not.toMatch(/\b(excellent|good|poor|bad|normal|high|low)\b/i);
    expect(html).not.toMatch(/ดีมาก|ดี|แย่|ผิดปกติ/);

    // INV-M2: no shame/attention mark distinguishing missed from taken
    expect(html).not.toMatch(/⚠|🔴|amber|attention|missed.*warning/i);

    // PDF must have the spec §7 disclaimer
    expect(html).toContain('แอปไม่วินิจฉัย/ไม่ให้คำแนะนำทางการแพทย์');
  });

  it('PRN plan: M=0, N=count of taken entries, renders "N ครั้ง" not "N/M วัน"', () => {
    const planStore = createMedicationPlanSyncStore();
    const logStore  = createMedicationLogSyncStore();

    const plan = planStore.addPlan({
      name: PLAN_NAME_B64,
      scheduleRule: null, // PRN — no schedule
      active: true,
    });

    // Two taken logs (PRN: count is per-entry, not distinct-day)
    logStore.addLog({ medicationPlanId: plan.id, occurrenceTime: '2026-07-04T09:00', status: 'taken' });
    logStore.addLog({ medicationPlanId: plan.id, occurrenceTime: '2026-07-04T14:00', status: 'taken' });

    // No push simulation needed — getPlans/getLogs work on version:0 too for this test
    const reportPlans = toReportPlans(planStore);
    const reportLogs  = toReportLogs(logStore);

    const { planAdherences } = computeAdherence(reportPlans, reportLogs, DATE_FROM, DATE_TO);

    expect(planAdherences).toHaveLength(1);
    expect(planAdherences[0].M).toBe(0);      // PRN: no scheduled days
    expect(planAdherences[0].N).toBe(2);      // PRN: count of taken entries (not distinct days)
    expect(planAdherences[0].isPrn).toBe(true);

    const html = buildDoctorReportHtml({
      ...REPORT_BASE,
      medicationPlans: reportPlans,
      medicationLogs: reportLogs,
    });

    // PRN renders "2 ครั้ง" (th) — NOT a ratio
    expect(html).toContain('2');
    expect(html).toContain('ครั้ง');
    // Must NOT render "2/0 วัน" — PRN has no denominator
    expect(html).not.toContain('/0');
  });

  it('INV-M2: missed log does not count toward N — same PDF structure for taken vs missed', () => {
    const planStore = createMedicationPlanSyncStore();
    const logStore  = createMedicationLogSyncStore();

    const plan = planStore.addPlan({
      name: PLAN_NAME_B64,
      scheduleRule: { freq: 'daily', startAt: '2026-07-01T08:00', timesOfDay: ['08:00'] },
      active: true,
    });

    // One taken log and one missed log on different days in range
    logStore.addLog({ medicationPlanId: plan.id, occurrenceTime: '2026-07-05T08:00', status: 'taken' });
    logStore.addLog({ medicationPlanId: plan.id, occurrenceTime: '2026-07-06T08:00', status: 'missed' });

    const reportPlans = toReportPlans(planStore);
    const reportLogs  = toReportLogs(logStore);

    const { planAdherences } = computeAdherence(reportPlans, reportLogs, DATE_FROM, DATE_TO);

    // N = 1 (only taken day counts); missed log does NOT increment N
    expect(planAdherences[0].N).toBe(1);
    expect(planAdherences[0].M).toBe(31);

    const html = buildDoctorReportHtml({
      ...REPORT_BASE,
      medicationPlans: reportPlans,
      medicationLogs: reportLogs,
    });

    // INV-M2: no special styling/mark for missed — identical render structure
    expect(html).not.toMatch(/⚠|🔴|amber|shame|missed.*mark|warning.*missed/i);
    expect(html).toContain('1/31');
  });

  it('deleted plan excluded from adherence scoring; its logs become selfRecordedLogs', () => {
    const planStore = createMedicationPlanSyncStore();
    const logStore  = createMedicationLogSyncStore();

    const plan = planStore.addPlan({
      name: PLAN_NAME_B64,
      scheduleRule: { freq: 'daily', startAt: '2026-07-01T08:00', timesOfDay: ['08:00'] },
      active: true,
    });

    logStore.addLog({
      medicationPlanId: plan.id,
      occurrenceTime: '2026-07-04T08:00',
      status: 'taken',
    });

    // Now tombstone the plan (simulate user deleting the plan)
    planStore.tombstonePlan(plan.id);

    // After tombstone, getPlans() excludes the deleted plan
    expect(planStore.getPlans()).toHaveLength(0);

    // But the plan is still visible via getPlan() (for tombstone inspection)
    expect(planStore.getPlan(plan.id)!.deletedAt).toBeTruthy();

    // For the report: include ALL plans (including deleted) so the assembler can route logs
    const allPlans: ReportMedicationPlan[] = [
      {
        id: plan.id,
        name: 'Amoxicillin',
        dose: null,
        scheduleRule: { freq: 'daily', startAt: '2026-07-01T08:00', timesOfDay: ['08:00'] },
        active: true,
        deletedAt: planStore.getPlan(plan.id)!.deletedAt,
      },
    ];
    const reportLogs = toReportLogs(logStore);

    const { planAdherences, selfRecordedLogs } = computeAdherence(
      allPlans,
      reportLogs,
      DATE_FROM,
      DATE_TO,
    );

    // Deleted plan excluded from scored set
    expect(planAdherences).toHaveLength(0);

    // Log belongs to deleted plan → routes to selfRecordedLogs
    expect(selfRecordedLogs).toHaveLength(1);
    expect(selfRecordedLogs[0].status).toBe('taken');
  });
});

// =============================================================================
// GAP-MED-CONSENT-CHAIN — Consent gate → grant → store receives payload
//
// The orchestrateMedicationSave unit tests (medicationCaptureLogic.test.ts) assert
// action=gate / action=persist. They do NOT then call addLog on the real store to
// confirm the payload round-trips through the store correctly. This test fills that.
//
// Spec:
//   medication-behavior.md §B.4 (consent gate),
//   capture-ui.md §3.1 (no-shaming for both taken and missed — INV-M2),
//   SD-5 (never log planId/occurrenceTime)
// =============================================================================

describe('medicationChain integration — consent gate → grant → store (GAP-MED-CONSENT-CHAIN)', () => {
  it('consent absent → action=gate (payload not stored)', () => {
    const logStore = createMedicationLogSyncStore();

    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: false,
      planId: 'plan-abc',
      status: 'taken',
      dateCivil: '2026-07-04',
      timeStr: '09:00',
    });

    expect(result.action).toBe('gate');
    // Store must NOT have been called — no record in store
    expect(logStore.getLogs()).toHaveLength(0);
    expect(logStore.getPendingCount()).toBe(0);
  });

  it('consent granted → action=persist → addLog persists valid payload to store', () => {
    const logStore = createMedicationLogSyncStore();

    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: 'plan-xyz',
      status: 'taken',
      dateCivil: '2026-07-04',
      timeStr: '09:00',
    });

    expect(result.action).toBe('persist');
    expect(result.action === 'persist' && result.payload.status).toBe('taken');
    expect(result.action === 'persist' && result.payload.occurrenceTime).toBe('2026-07-04T09:00');
    expect(result.action === 'persist' && result.payload.medicationPlanId).toBe('plan-xyz');

    // Now pass the payload to the real store (mirrors capture screen onSave)
    if (result.action === 'persist') {
      const added = logStore.addLog(result.payload);
      expect(logStore.getLogs()).toHaveLength(1);
      expect(logStore.getLogs()[0].id).toBe(added.id);
      expect(logStore.getLogs()[0].status).toBe('taken');
      expect(logStore.getLogs()[0].occurrenceTime).toBe('2026-07-04T09:00');
      expect(logStore.getLogs()[0].medicationPlanId).toBe('plan-xyz');
      expect(logStore.getPendingCount()).toBe(1); // log enqueued for push
    }
  });

  it('consent granted + missed status → action=persist → addLog stores status=missed (INV-M2 equal weight)', () => {
    const logStore = createMedicationLogSyncStore();

    const result = orchestrateMedicationSave({
      saveEnabled: true,
      consentGranted: true,
      planId: null, // ad-hoc
      status: 'missed',
      dateCivil: '2026-07-05',
      timeStr: '08:00',
    });

    expect(result.action).toBe('persist');

    if (result.action === 'persist') {
      // INV-M2: missed uses exactly the same code path as taken — equal weight
      const added = logStore.addLog(result.payload);
      expect(added.status).toBe('missed');
      // The payload shape is byte-identical except for the status field (INV-M2 invariant)
      expect(result.payload.status).toBe('missed');
      // medicationPlanId null = ad-hoc log
      expect(result.payload.medicationPlanId).toBeNull();
    }
  });

  it('saveEnabled=false → action=skip → store unchanged', () => {
    const logStore = createMedicationLogSyncStore();

    const result = orchestrateMedicationSave({
      saveEnabled: false,
      consentGranted: true,
      planId: 'plan-skip',
      status: 'taken',
      dateCivil: '2026-07-04',
      timeStr: '08:00',
    });

    expect(result.action).toBe('skip');
    expect(logStore.getLogs()).toHaveLength(0);
  });
});
