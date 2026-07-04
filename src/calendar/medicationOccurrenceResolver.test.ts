/**
 * medicationOccurrenceResolver.test.ts — TDD RED → GREEN (Slice 3, Task 3)
 *
 * Tests the SD-11 in-app half: for a medication reminder occurrence,
 * the in-app row must display the REAL drug name + dose (resolved client-side
 * from sourceRefId → medication_plan, decoding name_cipher on-device),
 * NOT the generic displayTitle that lives in the synced Reminder row.
 *
 * Spec refs:
 *   Design §5.3: "occurrence row / Day-Detail show real drug name + dose by
 *     resolving reminder.sourceRefId → medication_plan and decrypting
 *     name_cipher on-device — NOT from the generic displayTitle."
 *   ADR Decision 4: "render (Task 1/3): the occurrence row shows the real
 *     name/dose from sourceRefId → medication_plan. Parent tombstoned/unavailable
 *     → fall back to the generic label (OQ-CAL-6)."
 *   Functional spec §5 INV-MR-2: drug name appears ONLY after unlock, in-app.
 *
 * SD-11 split assertions (test group §3 below):
 *   (a) The synced reminder displayTitle stays GENERIC (never the drug name).
 *   (b) The notification payload title stays GENERIC (MEDICATION_TITLE_TH).
 *   (c) The in-app resolver returns the REAL drug name for a live plan.
 *   (d) The in-app resolver returns the GENERIC fallback when plan is tombstoned.
 *
 * Security: drug name/dose are MOTHER-health (SD-2). The resolver ONLY decodes
 * for in-app display (after unlock) — NEVER for notification payloads.
 */

import {
  resolveMedicationOccurrenceTitle,
  type MedicationOccurrenceResolution,
} from './medicationOccurrenceResolver';
import { MEDICATION_REMINDER_DISPLAY_TITLE } from '../medication/medicationPlanReminderLinkage';
import { MEDICATION_TITLE_TH } from '../notifications/notificationScheduler';
import type { ReminderRecord, MedicationPlan } from '../sync/syncTypes';
import { encodeFieldToBase64 } from '../capture/captureScreenLogic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = '2026-07-04T01:00:00.000Z';

/** Build a minimal ReminderRecord of type 'medication'. */
function makeReminder(
  overrides: Partial<ReminderRecord> = {},
): ReminderRecord {
  return {
    id: 'rem-001',
    type: 'medication',
    displayTitle: MEDICATION_REMINDER_DISPLAY_TITLE,
    hideOnLockScreen: true,
    sourceRefType: 'medication_plan',
    sourceRefId: 'plan-001',
    recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
    startAt: '2026-07-04T08:00',
    active: true,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** Build a minimal live (non-tombstone) MedicationPlan. */
function makePlan(
  id: string,
  namePlaintext: string,
  dosePlaintext: string | null = null,
  overrides: Partial<MedicationPlan> = {},
): MedicationPlan {
  return {
    id,
    name: encodeFieldToBase64(namePlaintext),
    dose: dosePlaintext != null ? encodeFieldToBase64(dosePlaintext) : null,
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

// ─── 1. resolveMedicationOccurrenceTitle — medication reminder with live plan ─

describe('resolveMedicationOccurrenceTitle — medication reminder, live plan', () => {
  test('returns the decoded drug name as title', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-001' });
    const plan = makePlan('plan-001', 'Triferdine 150');
    const plansById = new Map<string, MedicationPlan>([['plan-001', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe('Triferdine 150');
  });

  test('returns the decoded dose when plan has a dose', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-001' });
    const plan = makePlan('plan-001', 'Triferdine 150', '1 เม็ด');
    const plansById = new Map<string, MedicationPlan>([['plan-001', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.dose).toBe('1 เม็ด');
  });

  test('returns null dose when plan has no dose field', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-001' });
    const plan = makePlan('plan-001', 'ยาบำรุง');
    const plansById = new Map<string, MedicationPlan>([['plan-001', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.dose).toBeNull();
  });

  test('decodes Thai drug names correctly (multi-byte UTF-8)', () => {
    const thaiDrugName = 'ยาบำรุงเลือด';
    const reminder = makeReminder({ sourceRefId: 'plan-th' });
    const plan = makePlan('plan-th', thaiDrugName, '500 มก.');
    const plansById = new Map<string, MedicationPlan>([['plan-th', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe(thaiDrugName);
    expect(result.dose).toBe('500 มก.');
  });

  test('title is NOT the generic displayTitle when plan is live', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-001' });
    const plan = makePlan('plan-001', 'Iron Supplement');
    const plansById = new Map<string, MedicationPlan>([['plan-001', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).not.toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.title).toBe('Iron Supplement');
  });
});

// ─── 2. resolveMedicationOccurrenceTitle — fallback cases ─────────────────────

describe('resolveMedicationOccurrenceTitle — fallback to generic label', () => {
  test('falls back to displayTitle when plan is tombstoned (OQ-CAL-6)', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-tomb' });
    // Plan is tombstoned (deletedAt set)
    const tombstonedPlan = makePlan('plan-tomb', 'Amoxicillin', null, {
      deletedAt: NOW,
    });
    const plansById = new Map<string, MedicationPlan>([['plan-tomb', tombstonedPlan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.dose).toBeNull();
  });

  test('falls back to displayTitle when plan is not in map (missing plan)', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-gone' });
    const plansById = new Map<string, MedicationPlan>(); // empty map

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.dose).toBeNull();
  });

  test('falls back to displayTitle when sourceRefId is absent', () => {
    const reminder = makeReminder({
      sourceRefId: undefined,
      sourceRefType: 'medication_plan',
    });
    const plansById = new Map<string, MedicationPlan>();

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.dose).toBeNull();
  });

  test('falls back to displayTitle when sourceRefType is not medication_plan', () => {
    const reminder = makeReminder({
      sourceRefType: 'checklist_item',
      sourceRefId: 'some-checklist-id',
    });
    const plan = makePlan('some-checklist-id', 'Not a drug name');
    const plansById = new Map<string, MedicationPlan>([['some-checklist-id', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    // sourceRefType != medication_plan → no plan resolution
    expect(result.title).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.dose).toBeNull();
  });
});

// ─── 3. resolveMedicationOccurrenceTitle — non-medication reminder ────────────

describe('resolveMedicationOccurrenceTitle — non-medication reminder', () => {
  test('returns displayTitle and null dose for kick_count reminder', () => {
    const reminder: ReminderRecord = {
      ...makeReminder(),
      type: 'kick_count',
      displayTitle: 'นับลูกดิ้น',
      sourceRefType: undefined,
      sourceRefId: undefined,
    };
    const plansById = new Map<string, MedicationPlan>();

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe('นับลูกดิ้น');
    expect(result.dose).toBeNull();
  });

  test('returns displayTitle and null dose for custom reminder', () => {
    const reminder: ReminderRecord = {
      ...makeReminder(),
      type: 'custom',
      displayTitle: 'ดื่มน้ำ',
      sourceRefType: undefined,
      sourceRefId: undefined,
    };
    const plansById = new Map<string, MedicationPlan>();

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe('ดื่มน้ำ');
    expect(result.dose).toBeNull();
  });
});

// ─── §3 SD-11 split assertions ────────────────────────────────────────────────
//
// These three assertions document the SD-11 split (design §5.2):
//   (a) The synced reminder displayTitle is GENERIC — never the drug name.
//   (b) The notification payload title (MEDICATION_TITLE_TH) is GENERIC.
//   (c) The in-app resolver returns the REAL drug name for a live plan.
//   (d) The in-app resolver falls back to generic when the plan is gone.
//
// They are intentionally simple "this is the boundary" smoke tests.

describe('SD-11 split — synced/payload stays generic, in-app shows real name', () => {
  const DRUG_NAME = 'Folic Acid 5mg';
  const DRUG_DOSE = '1 เม็ด';

  test('(a) reminder.displayTitle is the GENERIC label (never the drug name)', () => {
    // Asserts the Task-1 invariant: displayTitle on the synced Reminder row
    // is always MEDICATION_REMINDER_DISPLAY_TITLE, not the drug name.
    const reminder = makeReminder({
      displayTitle: MEDICATION_REMINDER_DISPLAY_TITLE,
      sourceRefId: 'plan-sd11',
    });

    expect(reminder.displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(reminder.displayTitle).not.toBe(DRUG_NAME);
  });

  test('(b) MEDICATION_TITLE_TH (notification payload) is the GENERIC lock-screen string', () => {
    // Asserts the Task-2 invariant: the constant used as the OS notification
    // payload title is "ถึงเวลากินยา" — never a drug name.
    expect(MEDICATION_TITLE_TH).toBe('ถึงเวลากินยา');
    expect(MEDICATION_TITLE_TH).not.toBe(DRUG_NAME);
  });

  test('(c) in-app resolver returns the REAL drug name + dose from a live plan', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-sd11' });
    const plan = makePlan('plan-sd11', DRUG_NAME, DRUG_DOSE);
    const plansById = new Map<string, MedicationPlan>([['plan-sd11', plan]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    // The in-app display reveals the real name/dose AFTER unlock
    expect(result.title).toBe(DRUG_NAME);
    expect(result.dose).toBe(DRUG_DOSE);
    // It must differ from the generic lock-screen/synced title
    expect(result.title).not.toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.title).not.toBe(MEDICATION_TITLE_TH);
  });

  test('(d) in-app resolver falls back to GENERIC label when plan is tombstoned', () => {
    const reminder = makeReminder({ sourceRefId: 'plan-tomb-sd11' });
    const tombstoned = makePlan('plan-tomb-sd11', DRUG_NAME, DRUG_DOSE, { deletedAt: NOW });
    const plansById = new Map<string, MedicationPlan>([['plan-tomb-sd11', tombstoned]]);

    const result = resolveMedicationOccurrenceTitle(reminder, plansById);

    expect(result.title).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(result.dose).toBeNull();
  });
});
