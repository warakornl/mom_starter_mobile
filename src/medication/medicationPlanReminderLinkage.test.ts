/**
 * medicationPlanReminderLinkage.test.ts — TDD RED → GREEN (Slice 3, Task 1)
 *
 * Covers:
 *  1. buildLinkedReminder — mapping from MedicationPlan → ReminderRecord | null
 *       - type/sourceRef/hideOnLockScreen fields
 *       - displayTitle is GENERIC (never the drug name — SD-2 / ADR Decision 4)
 *       - recurrenceRule is verbatim copy (no transform)
 *       - startAt extracted from scheduleRule.startAt
 *       - active mirrors plan.active
 *       - PRN / null schedule_rule → null (no reminder)
 *  2. findLinkedReminder — lookup by sourceRefId in a CalendarReminderStore
 *  3. applyPlanCreateLinkage — on plan create: enqueueCreateReminder (if scheduled)
 *       PRN plan → no enqueue
 *  4. applyPlanUpdateLinkage — on plan update:
 *       - schedule unchanged → enqueueUpdateReminder
 *       - plan deactivated (active=false) → enqueueUpdateReminder with active=false
 *       - schedule_rule set to null (PRN) → enqueueDeleteReminder
 *       - no existing linked reminder → create one (PRN→scheduled transition)
 *  5. applyPlanTombstoneLinkage — on plan tombstone: enqueueDeleteReminder
 *
 * Security: displayTitle MUST NOT equal plan.name (drug name as SD-2 ciphertext
 * or decoded plaintext). The unit asserts this explicitly to keep the SD-2 leak
 * closed (ADR Decision 4, BINDING).
 */

import { v4 as uuidv4 } from 'uuid';
import {
  MEDICATION_REMINDER_DISPLAY_TITLE,
  buildLinkedReminder,
  findLinkedReminder,
  applyPlanCreateLinkage,
  applyPlanUpdateLinkage,
  applyPlanTombstoneLinkage,
  type CalendarReminderStore,
} from './medicationPlanReminderLinkage';
import type { MedicationPlan, ReminderRecord } from '../sync/syncTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = '2026-07-04T01:00:00.000Z';

function makeScheduledPlan(overrides: Partial<MedicationPlan> = {}): MedicationPlan {
  return {
    id: 'plan-uuid-0000-0000-0000-000000000001',
    name: 'Rm9saWMgQWNpZA==', // base64 opaque (drug name ciphertext — SD-2)
    dose: 'NTAwbWc=',
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

function makePrnPlan(overrides: Partial<MedicationPlan> = {}): MedicationPlan {
  return {
    ...makeScheduledPlan(),
    scheduleRule: null,
    ...overrides,
  };
}

// Minimal CalendarReminderStore stub — captures enqueue calls for assertions
function makeCalendarStoreStub(
  existingReminders: ReminderRecord[] = [],
): CalendarReminderStore & {
  created: ReminderRecord[];
  updated: ReminderRecord[];
  deleted: string[];
} {
  const created: ReminderRecord[] = [];
  const updated: ReminderRecord[] = [];
  const deleted: string[] = [];

  return {
    getActiveReminders: () => existingReminders,
    enqueueCreateReminder: (item) => {
      created.push({ ...item });
    },
    enqueueUpdateReminder: (item) => {
      updated.push({ ...item });
    },
    enqueueDeleteReminder: (id) => {
      deleted.push(id);
    },
    created,
    updated,
    deleted,
  };
}

// Build a minimal ReminderRecord linked to a plan (for testing update/tombstone paths)
function makeLinkedReminder(plan: MedicationPlan): ReminderRecord {
  return {
    id: uuidv4(),
    type: 'medication',
    displayTitle: MEDICATION_REMINDER_DISPLAY_TITLE,
    hideOnLockScreen: true,
    sourceRefType: 'medication_plan',
    sourceRefId: plan.id,
    recurrenceRule: {
      freq: 'daily',
      startAt: '2026-07-04T08:00',
      timesOfDay: ['08:00'],
    } as any,
    startAt: '2026-07-04T08:00',
    active: true,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

// ─── 1. buildLinkedReminder — mapping ─────────────────────────────────────────

describe('buildLinkedReminder', () => {
  test('returns null for PRN plan (scheduleRule === null)', () => {
    const plan = makePrnPlan();
    expect(buildLinkedReminder(plan, uuidv4(), NOW)).toBeNull();
  });

  test('returns a ReminderRecord for a scheduled plan', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW);
    expect(result).not.toBeNull();
  });

  test('type is "medication"', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.type).toBe('medication');
  });

  test('sourceRefType is "medication_plan"', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.sourceRefType).toBe('medication_plan');
  });

  test('sourceRefId equals the plan id', () => {
    const plan = makeScheduledPlan({ id: 'plan-abc' });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.sourceRefId).toBe('plan-abc');
  });

  test('hideOnLockScreen is true', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.hideOnLockScreen).toBe(true);
  });

  // ── SD-2 / ADR Decision 4: displayTitle MUST be generic, NEVER the drug name ─

  test('displayTitle is the constant MEDICATION_REMINDER_DISPLAY_TITLE', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
  });

  test('PRIVACY: displayTitle never equals plan.name (the drug name ciphertext)', () => {
    // plan.name is the base64 SD-2 drug-name ciphertext; the reminder MUST NOT copy it.
    const plan = makeScheduledPlan({ name: 'Rm9saWMgQWNpZA==' });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.displayTitle).not.toBe(plan.name);
  });

  test('PRIVACY: displayTitle never equals decoded drug name (plaintext)', () => {
    // The decoded drug name is "Folic Acid". The reminder MUST NOT contain it.
    const decodedName = 'Folic Acid';
    const encodedName = Buffer.from(decodedName).toString('base64');
    const plan = makeScheduledPlan({ name: encodedName });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.displayTitle).not.toBe(decodedName);
    expect(result.displayTitle).not.toBe(encodedName);
  });

  test('PRIVACY: displayTitle is generic even for plans with distinctive drug names', () => {
    // Multiple drugs → all get the same generic title (no drug-specific variant)
    const plans = [
      makeScheduledPlan({ name: Buffer.from('Amoxicillin').toString('base64') }),
      makeScheduledPlan({ name: Buffer.from('Metformin 500mg').toString('base64') }),
      makeScheduledPlan({ name: Buffer.from('ยาบำรุงเลือด').toString('base64') }),
    ];
    for (const plan of plans) {
      const result = buildLinkedReminder(plan, uuidv4(), NOW)!;
      expect(result.displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    }
  });

  // ── recurrenceRule: verbatim copy, no transform ────────────────────────────

  test('recurrenceRule has NO startAt key (RecurrenceRuleWire excludes startAt — Fix 2)', () => {
    // MedicationScheduleRule folds startAt inside the rule; RecurrenceRuleWire
    // does NOT have startAt (it is a separate top-level field on ReminderRecord).
    // The emitted recurrenceRule jsonb MUST NOT carry a duplicate startAt.
    const plan = makeScheduledPlan({
      scheduleRule: { freq: 'daily', startAt: '2026-07-04T08:00', timesOfDay: ['08:00'] },
    });
    const result = buildLinkedReminder(plan, 'rid', NOW)!;
    expect('startAt' in result.recurrenceRule).toBe(false);
  });

  test('recurrenceRule copies schedule_rule verbatim (freq, timesOfDay)', () => {
    const plan = makeScheduledPlan({
      scheduleRule: {
        freq: 'daily',
        startAt: '2026-07-04T08:00',
        timesOfDay: ['08:00', '20:00'],
      },
    });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.recurrenceRule.freq).toBe('daily');
    // timesOfDay must be verbatim
    expect((result.recurrenceRule as any).timesOfDay).toEqual(['08:00', '20:00']);
  });

  test('recurrenceRule copies every_n_days schedule with interval verbatim', () => {
    const plan = makeScheduledPlan({
      scheduleRule: {
        freq: 'every_n_days',
        startAt: '2026-07-04T08:00',
        timesOfDay: ['08:00'],
        interval: 3,
      },
    });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.recurrenceRule.freq).toBe('every_n_days');
    expect(result.recurrenceRule.interval).toBe(3);
  });

  test('recurrenceRule copies one_off schedule verbatim', () => {
    const plan = makeScheduledPlan({
      scheduleRule: {
        freq: 'one_off',
        startAt: '2026-07-04T14:30',
      },
    });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.recurrenceRule.freq).toBe('one_off');
  });

  // ── startAt extracted from scheduleRule.startAt ────────────────────────────

  test('startAt is derived from scheduleRule.startAt', () => {
    const plan = makeScheduledPlan({
      scheduleRule: { freq: 'daily', startAt: '2026-07-10T09:30', timesOfDay: ['09:30'] },
    });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.startAt).toBe('2026-07-10T09:30');
  });

  // ── active mirrors plan.active ─────────────────────────────────────────────

  test('active=true for an active plan', () => {
    const plan = makeScheduledPlan({ active: true });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.active).toBe(true);
  });

  test('active=false for a deactivated plan', () => {
    const plan = makeScheduledPlan({ active: false });
    const result = buildLinkedReminder(plan, 'reminder-id-001', NOW)!;
    expect(result.active).toBe(false);
  });

  // ── id and timestamps ──────────────────────────────────────────────────────

  test('id equals the reminderId passed in', () => {
    const plan = makeScheduledPlan();
    const reminderId = 'abc-reminder-id';
    const result = buildLinkedReminder(plan, reminderId, NOW)!;
    expect(result.id).toBe(reminderId);
  });

  test('version is 0 (create sentinel)', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'rid', NOW)!;
    expect(result.version).toBe(0);
  });

  test('createdAt and updatedAt equal the now parameter', () => {
    const plan = makeScheduledPlan();
    const result = buildLinkedReminder(plan, 'rid', NOW)!;
    expect(result.createdAt).toBe(NOW);
    expect(result.updatedAt).toBe(NOW);
  });
});

// ─── 2. findLinkedReminder ────────────────────────────────────────────────────

describe('findLinkedReminder', () => {
  test('returns the reminder with matching sourceRefId', () => {
    const plan = makeScheduledPlan({ id: 'plan-xyz' });
    const linkedReminder = makeLinkedReminder(plan);
    const store = makeCalendarStoreStub([linkedReminder]);

    const result = findLinkedReminder(plan.id, store);
    expect(result).toBeDefined();
    expect(result!.sourceRefId).toBe('plan-xyz');
  });

  test('returns undefined when no linked reminder exists', () => {
    const plan = makeScheduledPlan({ id: 'plan-xyz' });
    const otherReminder = makeLinkedReminder(makeScheduledPlan({ id: 'other-plan' }));
    const store = makeCalendarStoreStub([otherReminder]);

    const result = findLinkedReminder(plan.id, store);
    expect(result).toBeUndefined();
  });

  test('returns undefined when store is empty', () => {
    const store = makeCalendarStoreStub([]);
    const result = findLinkedReminder('plan-xyz', store);
    expect(result).toBeUndefined();
  });
});

// ─── 3. applyPlanCreateLinkage ────────────────────────────────────────────────

describe('applyPlanCreateLinkage', () => {
  test('enqueueCreateReminder is called for a scheduled plan', () => {
    const plan = makeScheduledPlan();
    const store = makeCalendarStoreStub();

    applyPlanCreateLinkage(plan, store, NOW);

    expect(store.created).toHaveLength(1);
    expect(store.updated).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });

  test('emitted reminder has correct type, sourceRef, and displayTitle', () => {
    const plan = makeScheduledPlan({ id: 'plan-aaa' });
    const store = makeCalendarStoreStub();

    applyPlanCreateLinkage(plan, store, NOW);

    const reminder = store.created[0];
    expect(reminder.type).toBe('medication');
    expect(reminder.sourceRefType).toBe('medication_plan');
    expect(reminder.sourceRefId).toBe('plan-aaa');
    expect(reminder.displayTitle).toBe(MEDICATION_REMINDER_DISPLAY_TITLE);
    expect(reminder.hideOnLockScreen).toBe(true);
  });

  test('emitted reminder displayTitle is NOT the drug name (SD-2 leak guard)', () => {
    const drugNameEncoded = Buffer.from('Iron Supplement').toString('base64');
    const plan = makeScheduledPlan({ name: drugNameEncoded });
    const store = makeCalendarStoreStub();

    applyPlanCreateLinkage(plan, store, NOW);

    const reminder = store.created[0];
    expect(reminder.displayTitle).not.toBe(drugNameEncoded);
    expect(reminder.displayTitle).not.toBe('Iron Supplement');
  });

  test('no reminder emitted for a PRN plan (scheduleRule === null)', () => {
    const plan = makePrnPlan();
    const store = makeCalendarStoreStub();

    applyPlanCreateLinkage(plan, store, NOW);

    expect(store.created).toHaveLength(0);
    expect(store.updated).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });
});

// ─── 4. applyPlanUpdateLinkage ────────────────────────────────────────────────

describe('applyPlanUpdateLinkage', () => {
  test('enqueueUpdateReminder called when schedule unchanged (existing reminder)', () => {
    const plan = makeScheduledPlan({ id: 'plan-upd' });
    const existingReminder = makeLinkedReminder(plan);
    const store = makeCalendarStoreStub([existingReminder]);

    applyPlanUpdateLinkage(plan, store, NOW);

    expect(store.updated).toHaveLength(1);
    expect(store.created).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });

  test('updated reminder preserves sourceRefId', () => {
    const plan = makeScheduledPlan({ id: 'plan-upd' });
    const existingReminder = makeLinkedReminder(plan);
    const store = makeCalendarStoreStub([existingReminder]);

    applyPlanUpdateLinkage(plan, store, NOW);

    expect(store.updated[0].sourceRefId).toBe('plan-upd');
  });

  test('deactivated plan → enqueueUpdateReminder with active=false', () => {
    const plan = makeScheduledPlan({ id: 'plan-deact', active: false });
    const existingReminder = makeLinkedReminder(plan);
    const store = makeCalendarStoreStub([existingReminder]);

    applyPlanUpdateLinkage(plan, store, NOW);

    expect(store.updated).toHaveLength(1);
    expect(store.updated[0].active).toBe(false);
  });

  test('plan schedule_rule set to null (PRN transition) → enqueueDeleteReminder', () => {
    // Plan was scheduled, now PRN — linked reminder must be deleted
    const plan = makePrnPlan({ id: 'plan-prn' });
    const existingReminder = makeLinkedReminder(makeScheduledPlan({ id: 'plan-prn' }));
    const store = makeCalendarStoreStub([existingReminder]);

    applyPlanUpdateLinkage(plan, store, NOW);

    expect(store.deleted).toHaveLength(1);
    expect(store.deleted[0]).toBe(existingReminder.id);
    expect(store.updated).toHaveLength(0);
  });

  test('PRN→scheduled transition (no existing reminder) → enqueueCreateReminder', () => {
    // Plan was PRN, now has a schedule — should create a new linked reminder
    const plan = makeScheduledPlan({ id: 'plan-new-sched' });
    const store = makeCalendarStoreStub([]); // no existing reminder

    applyPlanUpdateLinkage(plan, store, NOW);

    expect(store.created).toHaveLength(1);
    expect(store.created[0].sourceRefId).toBe('plan-new-sched');
    expect(store.updated).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });

  test('PRN plan with no existing reminder → no enqueue (still PRN, nothing to do)', () => {
    const plan = makePrnPlan({ id: 'plan-prn-noop' });
    const store = makeCalendarStoreStub([]); // no existing reminder

    applyPlanUpdateLinkage(plan, store, NOW);

    expect(store.created).toHaveLength(0);
    expect(store.updated).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });

  test('updated reminder recurrenceRule reflects new scheduleRule', () => {
    const plan = makeScheduledPlan({
      id: 'plan-edit',
      scheduleRule: {
        freq: 'every_n_days',
        startAt: '2026-07-10T09:00',
        timesOfDay: ['09:00'],
        interval: 2,
      },
    });
    const existingReminder = makeLinkedReminder(makeScheduledPlan({ id: 'plan-edit' }));
    const store = makeCalendarStoreStub([existingReminder]);

    applyPlanUpdateLinkage(plan, store, NOW);

    const updated = store.updated[0];
    expect(updated.recurrenceRule.freq).toBe('every_n_days');
    expect(updated.recurrenceRule.interval).toBe(2);
  });

  test('updatedAt on the updated reminder equals the now parameter', () => {
    const plan = makeScheduledPlan({ id: 'plan-ts' });
    const existingReminder = makeLinkedReminder(plan);
    const store = makeCalendarStoreStub([existingReminder]);

    const laterNow = '2026-07-05T10:00:00.000Z';
    applyPlanUpdateLinkage(plan, store, laterNow);

    expect(store.updated[0].updatedAt).toBe(laterNow);
  });
});

// ─── 5. applyPlanTombstoneLinkage ─────────────────────────────────────────────

describe('applyPlanTombstoneLinkage', () => {
  test('enqueueDeleteReminder called for the linked reminder', () => {
    const plan = makeScheduledPlan({ id: 'plan-tomb' });
    const existingReminder = makeLinkedReminder(plan);
    const store = makeCalendarStoreStub([existingReminder]);

    applyPlanTombstoneLinkage(plan.id, store);

    expect(store.deleted).toHaveLength(1);
    expect(store.deleted[0]).toBe(existingReminder.id);
    expect(store.updated).toHaveLength(0);
    expect(store.created).toHaveLength(0);
  });

  test('no enqueue when there is no linked reminder (PRN plan tombstoned)', () => {
    const store = makeCalendarStoreStub([]); // no linked reminder

    applyPlanTombstoneLinkage('plan-prn-tomb', store);

    expect(store.deleted).toHaveLength(0);
    expect(store.updated).toHaveLength(0);
    expect(store.created).toHaveLength(0);
  });
});
