/**
 * selfLogChain.integration.test.ts — cross-layer logic chain integration tests.
 *
 * These tests are the cross-cutting gap-fillers identified in the QA traceability
 * matrix (Task 10, Slice 1). They thread REAL module instances through the full
 * pipeline that per-task unit tests covered hop-by-hop but never end-to-end:
 *
 *   captureScreenLogic (buildSelfLogInput + orchestrateSave)
 *     → selfLogSyncStore (addSelfLog, drainQueue, stampApplied, upsertSelfLog,
 *                         adoptServerRecord, getSelfLogs, reset)
 *     → (mock sync push response: applied[])
 *     → doctorReportAssembler (buildDoctorReportHtml)
 *
 * Gap list addressed:
 *
 *   GAP-3 (Mobile end-to-end logic chain):
 *     No single jest test threaded the capture→store→drainQueue→(mock sync
 *     push response)→adopt-on-pull→appears-in-PDF chain at the logic level.
 *     Spec: self-log-behavior.md §B.3 (Data written), §B.4, sync contract §2,
 *     pdf-doctor-ui.md §3/§4.
 *
 *   GAP-SD-5f (consent gate → grant → store receives correct payload):
 *     orchestrateSave unit tests assert action=gate correctly but do NOT then
 *     call addSelfLog on the real store to verify the payload is valid and the
 *     store state is updated correctly.
 *     Spec: self-log-behavior.md §B.4, capture-ui.md §5, SD-5.
 *
 * Rules:
 *  - All module instances are REAL (no mocked store/assembler/logic).
 *  - No new store factories beyond createSelfLogSyncStore.
 *  - No weakening or duplication of existing unit tests.
 *  - Spec invariants explicitly asserted where named (AC-20/INV-S1, D2, D3, FLAG-1).
 *  - NEVER log valueNumeric / valueText / note (MOTHER-health SD-5).
 */

import { createSelfLogSyncStore } from './selfLogSyncStore';
import {
  buildSelfLogInput,
  decodeFieldFromBase64,
  orchestrateSave,
} from '../capture/captureScreenLogic';
import { buildDoctorReportHtml } from '../pdfReport/doctorReportAssembler';
import type { SelfLog, SyncChangeSet } from '../sync/syncTypes';
import type { DoctorReportInput, ReportSelfLog } from '../pdfReport/doctorReportAssembler';

// ─── Minimal report scaffold ────────────────────────────────────────────────────

const REPORT_INPUT_BASE: Omit<DoctorReportInput, 'selfLogs'> = {
  profile: {
    edd: '2026-11-01',
    gestationalWeek: 28,
    lifecycle: 'pregnant',
  },
  kickSessions: [],
  appointments: [],
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  reportDate: '2026-07-03',
  locale: 'th',
  includeSensitiveNotes: false,
};

// ─── Helper: simulate a minimal sync-push applied[] response ────────────────────

/**
 * Simulates what the sync engine does after receiving `applied[]` from the server:
 *  1. calls stampApplied with the server-assigned version + updatedAt
 *  2. (optionally) calls adoptServerRecord to reconcile the canonical record
 *
 * This is the contract §2 + §4 path exercised by syncClient.push() in production.
 * In tests we inline it so we don't need the real network layer.
 */
function simulatePushResponse(
  store: ReturnType<typeof createSelfLogSyncStore>,
  changeset: SyncChangeSet,
): void {
  // SyncChangeSet.selfLogs is at the top level (not nested under .changes)
  const created = changeset.selfLogs?.created ?? [];
  const serverUpdatedAt = new Date().toISOString();
  created.forEach((rec) => {
    // Server assigns version=1 for first application (spec §A.1 rule 5)
    const serverVersion = 1;
    store.stampApplied(rec.id, serverVersion, serverUpdatedAt);
    // Simulate server pull-back (adoptServerRecord = conflict resolution contract §4)
    const serverRecord: SelfLog = {
      ...rec,
      version: serverVersion,
      updatedAt: serverUpdatedAt,
      deletedAt: null,
    };
    store.adoptServerRecord(serverRecord);
  });
}

// ─── Helpers: build decoded ReportSelfLog[] from store ─────────────────────────

/**
 * Converts live store records to decoded ReportSelfLog[] for the assembler.
 * This mirrors what DoctorPdfScreen does before calling buildDoctorReportHtml.
 */
function toReportSelfLogs(store: ReturnType<typeof createSelfLogSyncStore>): ReportSelfLog[] {
  return store.getSelfLogs().map(log => ({
    id: log.id,
    loggedAt: log.loggedAt,
    metricType: log.metricType,
    valueNumeric: decodeFieldFromBase64(log.valueNumeric ?? null),
    valueNumericSecondary: decodeFieldFromBase64(log.valueNumericSecondary ?? null),
    valueText: decodeFieldFromBase64(log.valueText ?? null),
    unit: log.unit ?? null,
    note: decodeFieldFromBase64(log.note ?? null),
  }));
}

// =============================================================================
// GAP-3: Full logic chain happy path
//
// Chain: buildSelfLogInput → addSelfLog → drainQueue → (mock push applied[]) →
//        stampApplied + adoptServerRecord → getSelfLogs → toReportSelfLogs →
//        buildDoctorReportHtml renders the decoded weight value in PDF section
//
// Spec:
//   §B.3 (data written to SelfLogInput),
//   sync contract §2 (stampApplied after applied[]),
//   sync contract §4 (adoptServerRecord for conflict resolution),
//   pdf-doctor-ui.md §3 (self-logs section in PDF),
//   AC-20 / INV-S1 (no grade words in PDF output)
// =============================================================================

describe('selfLogChain integration — happy path (GAP-3)', () => {
  it('weight: buildSelfLogInput → addSelfLog → drainQueue → push response → getSelfLogs → PDF contains decoded weight', () => {
    const store = createSelfLogSyncStore();

    // ── Step 1: Build input from form values (capture logic layer) ───────────
    const input = buildSelfLogInput({
      metricType: 'weight',
      weightValue: '64.2',
      loggedAt: '2026-07-03T09:00',
    });
    // Validate the payload shape (§B.3: value encoded)
    expect(input.metricType).toBe('weight');
    expect(input.valueNumeric).toBeTruthy(); // base64-encoded
    expect(input.valueText).toBeNull();
    expect(input.valueNumericSecondary).toBeNull();
    expect(input.unit).toBe('kg');
    // Decoded value must round-trip correctly (FLAG-1 + codec invariant)
    expect(decodeFieldFromBase64(input.valueNumeric!)).toBe('64.2');

    // ── Step 2: Persist to local store ───────────────────────────────────────
    const added = store.addSelfLog(input);
    expect(store.getSelfLogs()).toHaveLength(1);
    expect(store.getSelfLogs()[0].metricType).toBe('weight');
    expect(store.getSelfLogs()[0].loggedAt).toBe('2026-07-03T09:00'); // FLAG-1: floating-civil

    // ── Step 3: Drain queue (→ sync/push body payload) ───────────────────────
    const changeset = store.drainQueue();
    expect(changeset.selfLogs!.created).toHaveLength(1);
    expect(changeset.selfLogs!.updated).toHaveLength(0); // D2: immutable
    expect(changeset.selfLogs!.deleted).toHaveLength(0);
    const queued = changeset.selfLogs!.created[0];
    expect(queued.id).toBe(added.id);
    // Queue cleared after drain (contract §1)
    expect(store.getPendingCount()).toBe(0);

    // ── Step 4: Simulate server applied[] response ────────────────────────────
    simulatePushResponse(store, changeset);
    // After stampApplied, version is 1
    const afterPush = store.getSelfLog(added.id)!;
    expect(afterPush.version).toBe(1);

    // ── Step 5: getSelfLogs returns the record with original payload intact ───
    const logs = store.getSelfLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(added.id);

    // ── Step 6: Decode for PDF assembler (mirrors DoctorPdfScreen) ───────────
    const reportLogs = toReportSelfLogs(store);
    expect(reportLogs).toHaveLength(1);
    // Decoded value is human-readable plaintext (codec round-trip — FLAG-1)
    expect(reportLogs[0].valueNumeric).toBe('64.2');
    expect(reportLogs[0].metricType).toBe('weight');

    // ── Step 7: buildDoctorReportHtml renders the value in the PDF ───────────
    const html = buildDoctorReportHtml({
      ...REPORT_INPUT_BASE,
      selfLogs: reportLogs,
    });
    // PDF must contain the decoded weight value (verbatim — INV-S1/INV-S2)
    expect(html).toContain('64.2');
    // INV-S1: no grade words in any language (AC-20)
    expect(html).not.toMatch(/\b(normal|high|low|abnormal)\b/i);
    expect(html).not.toMatch(/สูง|ต่ำ|ผิดปกติ/);
    // PDF must always have the spec §7 disclaimer (pdf-doctor-ui §3)
    // Actual disclaimer text from doctorReportAssembler.ts labels.th.disclaimer
    expect(html).toContain('แอปไม่วินิจฉัย/ไม่ให้คำแนะนำทางการแพทย์');
  });

  it('blood_pressure: full chain with systolic+diastolic decoded verbatim in PDF', () => {
    const store = createSelfLogSyncStore();

    // Build input for BP (valueNumeric=systolic, valueNumericSecondary=diastolic — §B.3)
    const input = buildSelfLogInput({
      metricType: 'blood_pressure',
      systolicValue: '120',
      diastolicValue: '80',
      loggedAt: '2026-07-03T10:00',
    });
    expect(decodeFieldFromBase64(input.valueNumeric!)).toBe('120');
    expect(decodeFieldFromBase64(input.valueNumericSecondary!)).toBe('80');
    expect(input.unit).toBe('mmHg');

    const added = store.addSelfLog(input);
    const changeset = store.drainQueue();
    simulatePushResponse(store, changeset);

    const reportLogs = toReportSelfLogs(store);
    expect(reportLogs[0].valueNumeric).toBe('120');
    expect(reportLogs[0].valueNumericSecondary).toBe('80');

    const html = buildDoctorReportHtml({
      ...REPORT_INPUT_BASE,
      selfLogs: reportLogs,
    });
    // Both readings rendered verbatim (INV-S1: no grading regardless of value)
    expect(html).toContain('120');
    expect(html).toContain('80');
    // INV-S1: no grade words (AC-20) — BP 120/80 must not trigger grading
    expect(html).not.toMatch(/\b(normal|high|low|abnormal)\b/i);
  });

  it('D2 idempotent: draining queue twice does not double-enqueue the same record', () => {
    const store = createSelfLogSyncStore();
    store.addSelfLog(buildSelfLogInput({
      metricType: 'weight',
      weightValue: '65',
      loggedAt: '2026-07-03T11:00',
    }));
    const first = store.drainQueue();
    // Queue cleared after first drain
    const second = store.drainQueue();
    expect(first.selfLogs!.created).toHaveLength(1);
    // Second drain is empty — no re-enqueue (D2 idempotent drain)
    expect(second.selfLogs!.created).toHaveLength(0);
  });

  it('adoptServerRecord pull path: record from pull (upsertSelfLog) appears in PDF', () => {
    // Simulates a pull-received record (other device's weight log) being adopted
    // and then rendered in the PDF — the pull→PDF path (spec §A.2 → pdf §4)
    const store = createSelfLogSyncStore();
    const now = new Date().toISOString();
    const serverRecord: SelfLog = {
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      metricType: 'weight',
      valueNumeric: Buffer.from('72.5', 'utf8').toString('base64'),
      valueNumericSecondary: null,
      valueText: null,
      unit: 'kg',
      loggedAt: '2026-07-02T08:30',
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    store.upsertSelfLog(serverRecord);

    const logs = store.getSelfLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe('bbbbbbbb-0000-4000-8000-000000000001');

    const reportLogs = toReportSelfLogs(store);
    expect(reportLogs[0].valueNumeric).toBe('72.5');

    const html = buildDoctorReportHtml({
      ...REPORT_INPUT_BASE,
      selfLogs: reportLogs,
    });
    expect(html).toContain('72.5');
  });
});

// =============================================================================
// GAP-SD-5f: Consent gate → grant → addSelfLog wiring
//
// orchestrateSave returns action=gate with payload. The caller is expected to
// hold the payload and call addSelfLog(payload) when consent is granted.
// This test verifies the payload from orchestrateSave is compatible with the
// real store's addSelfLog — i.e., the handoff between the two modules is
// correct and the full grant path persists the right data.
//
// Spec: self-log-behavior.md §B.4 (grant path), capture-ui.md §5,
//       SD-5 (fail-closed consent), SD-5f gap identified in traceability matrix.
// =============================================================================

describe('selfLogChain integration — consent gate → grant → store (GAP-SD-5f)', () => {
  it('gate payload from orchestrateSave can be passed directly to addSelfLog on grant', () => {
    const store = createSelfLogSyncStore();

    // ── Step 1: orchestrateSave with consent NOT granted → action=gate ────────
    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: false, // general_health declined (SD-5)
      metricType: 'weight',
      dateCivil: '2026-07-03',
      timeStr: '14:00',
      weightValue: '63.0',
    });
    expect(result.action).toBe('gate');
    // Store is empty — nothing was persisted before grant
    expect(store.getSelfLogs()).toHaveLength(0);

    // ── Step 2: Simulate JIT nudge shown; user grants consent ────────────────
    // Caller holds the payload from the gate result and calls addSelfLog on grant.
    if (result.action !== 'gate') throw new Error('Expected gate action');
    const heldPayload = result.payload;

    // Verify the held payload has the correct data (before it touches the store)
    expect(heldPayload.metricType).toBe('weight');
    expect(heldPayload.loggedAt).toBe('2026-07-03T14:00'); // FLAG-1 floating-civil
    // Payload value is base64-encoded (D3: stored as ciphertext)
    expect(decodeFieldFromBase64(heldPayload.valueNumeric!)).toBe('63.0');

    // ── Step 3: Grant confirmed → addSelfLog with the held payload ────────────
    const added = store.addSelfLog(heldPayload);

    // Store now has the record
    const logs = store.getSelfLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(added.id);
    expect(logs[0].metricType).toBe('weight');
    expect(logs[0].loggedAt).toBe('2026-07-03T14:00');
    // The encoded value was preserved through the gate→hold→store chain
    expect(decodeFieldFromBase64(logs[0].valueNumeric!)).toBe('63.0');

    // ── Step 4: Verify it drains to push queue correctly ─────────────────────
    const changeset = store.drainQueue();
    expect(changeset.selfLogs!.created).toHaveLength(1);
    expect(changeset.selfLogs!.created[0].metricType).toBe('weight');
  });

  it('gate then NO grant → store stays empty (fail-closed SD-5)', () => {
    const store = createSelfLogSyncStore();

    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: false,
      metricType: 'blood_pressure',
      dateCivil: '2026-07-03',
      timeStr: '15:00',
      systolicValue: '130',
      diastolicValue: '85',
    });
    expect(result.action).toBe('gate');

    // User dismisses the nudge without granting — addSelfLog is NEVER called
    // Store must remain empty (fail-closed: nothing persists without consent)
    expect(store.getSelfLogs()).toHaveLength(0);
    expect(store.getPendingCount()).toBe(0);
    const changeset = store.drainQueue();
    expect(changeset.selfLogs!.created).toHaveLength(0);
  });

  it('persist path: consentGranted=true → orchestrateSave returns persist; addSelfLog succeeds', () => {
    const store = createSelfLogSyncStore();

    const result = orchestrateSave({
      saveEnabled: true,
      consentGranted: true, // already granted
      metricType: 'weight',
      dateCivil: '2026-07-03',
      timeStr: '16:00',
      weightValue: '65.5',
    });
    // Direct persist path: no gate needed
    expect(result.action).toBe('persist');
    if (result.action !== 'persist') throw new Error('Expected persist action');

    // Caller immediately calls addSelfLog (no hold needed)
    store.addSelfLog(result.payload);

    expect(store.getSelfLogs()).toHaveLength(1);
    expect(store.getSelfLogs()[0].metricType).toBe('weight');
    expect(decodeFieldFromBase64(store.getSelfLogs()[0].valueNumeric!)).toBe('65.5');
  });
});

// =============================================================================
// PDPA: reset() after logout clears chain state (cross-account isolation)
//
// Spec: pdpa-assessment.md §1.1; selfLogSyncStore.ts (reset() contract).
// This is a chain-level confirmation that the reset clears everything that
// was built up through the full capture→store chain above.
// =============================================================================

describe('selfLogChain integration — PDPA reset clears chain state', () => {
  it('after full chain capture, reset() leaves store empty (no cross-account leak)', () => {
    const store = createSelfLogSyncStore();

    // Build up full chain state
    const input = buildSelfLogInput({
      metricType: 'weight',
      weightValue: '70',
      loggedAt: '2026-07-03T17:00',
    });
    store.addSelfLog(input);
    const changeset = store.drainQueue();
    simulatePushResponse(store, changeset);
    store.setWatermark('2026-07-03T17:01:00.000Z');

    // Confirm state is populated
    expect(store.getSelfLogs()).toHaveLength(1);
    expect(store.getWatermark()).toBeDefined();

    // Simulate logout
    store.reset();

    // All state cleared — no cross-account leak (PDPA 1.1)
    expect(store.getSelfLogs()).toHaveLength(0);
    expect(store.getPendingCount()).toBe(0);
    expect(store.getWatermark()).toBeUndefined();
    const drainedAfterReset = store.drainQueue();
    expect(drainedAfterReset.selfLogs!.created).toHaveLength(0);
    expect(drainedAfterReset.selfLogs!.deleted).toHaveLength(0);

    // PDF assembler with empty store = empty-range section (not an error)
    const html = buildDoctorReportHtml({
      ...REPORT_INPUT_BASE,
      selfLogs: toReportSelfLogs(store),
    });
    // Empty-range wording must appear (spec §A.4 empty-range invariant)
    expect(html).toContain('ไม่มีข้อมูลในช่วงนี้');
  });
});
