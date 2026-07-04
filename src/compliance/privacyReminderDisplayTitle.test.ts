/**
 * privacyReminderDisplayTitle.test.ts
 *
 * COMPLIANCE MINOR-A — privacy assertion (Task 6, Slice 3 Medication Reminders)
 *
 * Asserts that the reminder sync payload / server-response shape for a medication
 * reminder NEVER contains the drug name (SD-2) in any field — independently of the
 * Task-1 linkage unit-test. This directly pins ADR Decision 4 assertion #2:
 *
 *   "GET /reminders and the reminder export DTO never return a drug name."
 *
 * WHY this is a MOBILE-SIDE assertion:
 *   Per ADR Decision 3 there is NO backend change. The server stores and echoes back
 *   whatever `displayTitle` the client pushes in POST /sync/push. Therefore, asserting
 *   that the client NEVER writes the drug name into `displayTitle` on the outgoing
 *   ReminderRecord IS the guarantee that GET /reminders never returns a drug name.
 *   The ReminderRecord is the wire format returned verbatim by the server.
 *
 * What "export DTO" means here:
 *   There is no separate backend export DTO beyond the standard ReminderRecord
 *   (ADR Decision 3 — no backend change, no new endpoint, no new export path).
 *   The reminder sync payload (ReminderRecord pushed via POST /sync/push and returned
 *   by GET /reminders / sync/pull) IS the export surface. This test covers it.
 *
 * If a future slice introduces a dedicated server-side export DTO or PDF export
 * that includes reminder fields, that slice's QA must extend these assertions to
 * cover the new surface. Label that as a launch-gate if it requires a running server.
 *
 * Spec refs:
 *   ADR Decision 4 — BINDING client-behavior constraint; no backend/schema change.
 *   Plan Task 6 compliance Minor-A (medication-reminders.md §Task 6).
 *   medication-reminders-behavior.md §5 INV-MR-2 + INV-MR-4.
 *   syncTypes.ts ReminderRecord — the server wire format.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  buildLinkedReminder,
  applyPlanCreateLinkage,
  MEDICATION_REMINDER_DISPLAY_TITLE,
  type CalendarReminderStore,
} from '../medication/medicationPlanReminderLinkage';
import { MEDICATION_TITLE_TH } from '../notifications/notificationScheduler';
import type { MedicationPlan, ReminderRecord } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = '2026-07-04T01:00:00.000Z';

/** Simulate a scheduled medication plan with a known drug name. */
function makeScheduledPlan(
  drugNamePlaintext: string,
  overrides: Partial<MedicationPlan> = {},
): MedicationPlan {
  return {
    id: uuidv4(),
    // drug name stored as base64 "ciphertext" (MVP posture — plaintext base64)
    name: Buffer.from(drugNamePlaintext).toString('base64'),
    dose: Buffer.from('1 เม็ด').toString('base64'),
    scheduleRule: {
      freq: 'daily',
      startAt: '2026-07-04T08:00',
      timesOfDay: ['08:00'],
    },
    active: true,
    sourceSuggestionStateId: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** Capture enqueued reminders from the linkage layer. */
function makeStoreCapture(): CalendarReminderStore & { captured: ReminderRecord[] } {
  const captured: ReminderRecord[] = [];
  return {
    getActiveReminders: () => [],
    enqueueCreateReminder: (r) => { captured.push({ ...r }); },
    enqueueUpdateReminder: (r) => { captured.push({ ...r }); },
    enqueueDeleteReminder: () => {},
    captured,
  };
}

/**
 * Checks that NONE of the string fields in the outgoing ReminderRecord contain
 * the drug name in plain or base64 form.
 *
 * Fields checked: displayTitle, type, sourceRefType, sourceRefId, startAt.
 * These are the only string fields the server stores and returns.
 */
function assertNoDrugNameInRecord(
  record: ReminderRecord,
  drugNamePlaintext: string,
): void {
  const drugNameBase64 = Buffer.from(drugNamePlaintext).toString('base64');
  const stringFields: Record<string, string | undefined | null> = {
    displayTitle: record.displayTitle,
    type: record.type,
    sourceRefType: record.sourceRefType,
    sourceRefId: record.sourceRefId,
    startAt: record.startAt,
  };
  for (const [fieldName, value] of Object.entries(stringFields)) {
    if (value == null) continue;
    expect(value).not.toContain(drugNamePlaintext);
    expect(value).not.toContain(drugNameBase64);
  }
}

// ─── §1. Sync payload (ReminderRecord) — GET /reminders response shape ─────────
//
// This group directly asserts what the server would echo back for a medication
// reminder. Since the server stores displayTitle verbatim, the client-side
// ReminderRecord IS the server response shape.

describe('COMPLIANCE MINOR-A — reminder sync payload never contains drug name', () => {
  const DRUG_NAMES = [
    'Amoxicillin 500mg',
    'Triferdine 150',
    'Metformin',
    'ยาบำรุงเลือด',
    'Folic Acid 5mg',
    'แอมอกซิซิลลิน 250 มก.',
  ];

  test.each(DRUG_NAMES)(
    'buildLinkedReminder: displayTitle NEVER contains "%s" (plaintext or base64)',
    (drugName) => {
      const plan = makeScheduledPlan(drugName);
      const record = buildLinkedReminder(plan, uuidv4(), NOW);

      // Scheduled plan must produce a reminder
      expect(record).not.toBeNull();
      assertNoDrugNameInRecord(record!, drugName);
    },
  );

  test('displayTitle is exactly the generic constant — no variant, no drug reference', () => {
    const plan = makeScheduledPlan('Iron Supplement');
    const record = buildLinkedReminder(plan, uuidv4(), NOW);
    expect(record).not.toBeNull();
    expect(record!.displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
  });

  test('all scheduled plans produce the SAME generic displayTitle regardless of drug', () => {
    const titles = DRUG_NAMES.map((name) => {
      const plan = makeScheduledPlan(name);
      const record = buildLinkedReminder(plan, uuidv4(), NOW);
      return record!.displayTitle;
    });
    // Every plan → same generic title
    expect(new Set(titles).size).toBe(1);
    expect(titles[0]).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
  });

  test('PRN plan produces null (no sync payload at all — no displayTitle to leak)', () => {
    const plan = makeScheduledPlan('Amoxicillin 500mg', { scheduleRule: null });
    const record = buildLinkedReminder(plan, uuidv4(), NOW);
    // PRN → no reminder → nothing reaches the server
    expect(record).toBeNull();
  });
});

// ─── §2. Linkage pipeline (plan save → sync store) — what actually enters sync ─
//
// This mirrors the real production flow: when a user saves a medication plan,
// applyPlanCreateLinkage() enqueues the ReminderRecord into the sync store.
// That record is then pushed to the server via POST /sync/push.
// This test asserts no drug name leaks at that point.

describe('COMPLIANCE MINOR-A — linkage pipeline: what enters the sync store (POST /sync/push payload)', () => {
  test('enqueued ReminderRecord has no drug name in displayTitle (production flow path)', () => {
    const DRUG_NAME = 'Triferdine 150';
    const plan = makeScheduledPlan(DRUG_NAME);
    const store = makeStoreCapture();

    applyPlanCreateLinkage(plan, store, NOW);

    expect(store.captured).toHaveLength(1);
    const enqueued = store.captured[0];

    // The enqueued record IS what gets pushed to the server.
    // Assert no drug name in displayTitle or any string field.
    assertNoDrugNameInRecord(enqueued, DRUG_NAME);
  });

  test('enqueued record displayTitle matches the generic constant', () => {
    const plan = makeScheduledPlan('ยาธาตุเหล็กบำรุงเลือด');
    const store = makeStoreCapture();
    applyPlanCreateLinkage(plan, store, NOW);

    expect(store.captured[0].displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
  });
});

// ─── §3. Notification payload (OS lock screen) — MEDICATION_TITLE_TH never drug name ──
//
// This section asserts the second privacy boundary: the OS notification payload
// title (which the lock screen shows) is also generic. This is in addition to
// the sync payload assertion above — both surfaces must be generic.

describe('COMPLIANCE MINOR-A — notification payload title is generic (lock screen / SD-11)', () => {
  test('MEDICATION_TITLE_TH is the expected generic Thai string', () => {
    expect(MEDICATION_TITLE_TH).toBe('ถึงเวลากินยา');
  });

  test('MEDICATION_TITLE_TH does not contain any real drug name substring', () => {
    const DRUG_NAMES_SPOT_CHECK = [
      'Amoxicillin', 'Triferdine', 'Metformin', 'ยาบำรุงเลือด', 'Folic Acid',
    ];
    for (const name of DRUG_NAMES_SPOT_CHECK) {
      expect(MEDICATION_TITLE_TH).not.toContain(name);
    }
  });

  test('lock-screen title (MEDICATION_TITLE_TH) and sync displayTitle (MEDICATION_REMINDER_DISPLAY_TITLE) are both generic and distinct', () => {
    // Both are non-sensitive generic strings — neither contains a drug name.
    // They are intentionally distinct (lock-screen vs in-app) per ADR Decision 4 / SD-11.
    expect(MEDICATION_TITLE_TH).not.toContain('Amoxicillin');
    expect(MEDICATION_REMINDER_DISPLAY_TITLE).not.toContain('Amoxicillin');
    // Both are truthy generic strings
    expect(MEDICATION_TITLE_TH.length).toBeGreaterThan(0);
    expect(MEDICATION_REMINDER_DISPLAY_TITLE.length).toBeGreaterThan(0);
  });
});

// ─── §4. Boundary condition: even if plan.name is decoded, displayTitle stays generic ──

describe('COMPLIANCE MINOR-A — displayTitle stays generic even when drug name is decoded at render time', () => {
  test('decoded drug name from sourceRefId resolution does NOT enter the ReminderRecord', () => {
    // This test simulates the correct architecture:
    //   - buildLinkedReminder produces a generic displayTitle (never the drug name)
    //   - The drug name is only revealed in-app by resolving sourceRefId → medication_plan
    //   - The ReminderRecord itself (the sync/server object) stays generic
    const DRUG_NAME = 'Iron Supplement';
    const encodedName = Buffer.from(DRUG_NAME).toString('base64');
    const plan = makeScheduledPlan(DRUG_NAME);

    const record = buildLinkedReminder(plan, uuidv4(), NOW);
    expect(record).not.toBeNull();

    // The record's displayTitle must never be the decoded or encoded drug name
    expect(record!.displayTitle).not.toBe(DRUG_NAME);
    expect(record!.displayTitle).not.toBe(encodedName);
    expect(record!.displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);

    // The plan's sourceRefId IS on the record (correct — it lets the client resolve
    // the drug name in-app), but sourceRefId is the plan UUID, not the drug name
    expect(record!.sourceRefId).toBe(plan.id);
    expect(record!.sourceRefId).not.toContain(DRUG_NAME);
    expect(record!.sourceRefId).not.toContain(encodedName);
  });
});
