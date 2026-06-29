/**
 * CalendarSyncStore tests — reminder/occurrence/checklist sync wiring.
 *
 * Covers:
 *   - Reminder CRUD + queue drain
 *   - Occurrence enqueue (only done/snoozed — FLAG-7/W-A)
 *   - Occurrence M1 status-merge precedence
 *   - Occurrence deterministic id (computeOccurrenceId)
 *   - ChecklistItem CRUD + queue drain
 *   - drainQueue produces correct SyncChangeSet shape
 *   - reset() clears all state (PDPA logout)
 */

import { createCalendarSyncStore } from './calendarSyncStore';
import type {
  ReminderRecord,
  ReminderOccurrenceRecord,
  ChecklistItemRecord,
} from './syncTypes';
import { computeOccurrenceId } from '../occurrence/occurrenceId';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReminder(partial: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: 'rem-001',
    type: 'custom',
    displayTitle: 'Test reminder',
    recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
    startAt: '2026-07-01T08:00',
    active: true,
    version: 0,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

function makeChecklist(partial: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'ci-001',
    category: 'appointment',
    title: 'ANC Visit',
    scheduledAt: '2026-07-10T09:00',
    done: false,
    version: 0,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

// ─── Reminder tests ───────────────────────────────────────────────────────────

describe('CalendarSyncStore — reminders', () => {

  it('enqueueCreate adds to map and pending queue', () => {
    const store = createCalendarSyncStore();
    const rem = makeReminder();
    store.enqueueCreateReminder(rem);
    expect(store.getReminder('rem-001')).toMatchObject({ id: 'rem-001' });
    expect(store.getActiveReminders()).toHaveLength(1);
    expect(store.getPendingCount()).toBe(1);
  });

  it('enqueueDelete tombstones locally and queues delete', () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder());
    store.enqueueDeleteReminder('rem-001');
    // Tombstoned → not in active list
    expect(store.getActiveReminders()).toHaveLength(0);
    // Still in map (tombstone retained)
    expect(store.getReminder('rem-001')).toBeDefined();
    expect(store.getPendingCount()).toBe(2); // create + delete
  });

  it('upsert de-dups by version: same version skips', () => {
    const store = createCalendarSyncStore();
    const rem = makeReminder({ version: 2 });
    store.upsertReminder(rem);
    store.upsertReminder({ ...rem, displayTitle: 'Changed', version: 2 });
    expect(store.getReminder('rem-001')?.displayTitle).toBe('Test reminder');
  });

  it('stampApplied updates version + updatedAt', () => {
    const store = createCalendarSyncStore();
    store.upsertReminder(makeReminder({ version: 1, updatedAt: 'old' }));
    store.stampReminderApplied('rem-001', 2, '2026-07-01T00:00:00Z');
    expect(store.getReminder('rem-001')?.version).toBe(2);
    expect(store.getReminder('rem-001')?.updatedAt).toBe('2026-07-01T00:00:00Z');
  });

  it('drainQueue returns reminders in changeSet and clears queue', () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder());
    store.enqueueDeleteReminder('other-id');
    const cs = store.drainQueue();
    expect(cs.reminders?.created).toHaveLength(1);
    expect(cs.reminders?.deleted).toContain('other-id');
    expect(store.getPendingCount()).toBe(0);
  });

});

// ─── Occurrence tests (FLAG-7 / W-A / M1) ────────────────────────────────────

describe('CalendarSyncStore — reminderOccurrences (FLAG-7/W-A/M1)', () => {

  it('enqueueOccurrence computes deterministic id and queues as done', () => {
    const store = createCalendarSyncStore();
    store.enqueueOccurrence('rem-001', '2026-07-01T08:00', 'done', new Date().toISOString());

    const expectedId = computeOccurrenceId('rem-001', '2026-07-01T08:00');
    const occ = store.getOccurrence(expectedId);
    expect(occ?.id).toBe(expectedId);
    expect(occ?.status).toBe('done');
    expect(occ?.reminderId).toBe('rem-001'); // lowercase preserved

    const cs = store.drainQueue();
    expect(cs.reminderOccurrences?.created).toHaveLength(1);
    expect(cs.reminderOccurrences?.created[0].status).toBe('done');
  });

  it('enqueueOccurrence lowercase normalises reminderId (🟡-3)', () => {
    const store = createCalendarSyncStore();
    store.enqueueOccurrence('REM-001', '2026-07-01T08:00', 'done', new Date().toISOString());
    // id must match the lowercase-normalised version
    const expectedId = computeOccurrenceId('rem-001', '2026-07-01T08:00');
    expect(store.getOccurrence(expectedId)).toBeDefined();
  });

  it('FLAG-7/W-A: due/missed NEVER pushed — drainQueue filters them out', () => {
    const store = createCalendarSyncStore();
    // Inject a due occurrence directly into the map + pending queue
    // (simulating a bug where status=due got queued)
    const dueOcc: ReminderOccurrenceRecord = {
      id: computeOccurrenceId('rem-001', '2026-07-01T08:00'),
      reminderId: 'rem-001',
      scheduledLocalTime: '2026-07-01T08:00',
      status: 'due',
      version: 0,
      createdAt: '',
      updatedAt: '',
    };
    // Bypass public API to test the defensive filter in drainQueue
    store.upsertOccurrence(dueOcc);
    // Access internal queue via re-enqueue trick
    store.reEnqueueChangeset({
      reminderOccurrences: { created: [dueOcc], updated: [], deleted: [] },
    });
    const cs = store.drainQueue();
    // drainQueue must filter out due → nothing in created
    expect(cs.reminderOccurrences?.created).toHaveLength(0);
  });

  it('M1: done/snoozed must not be overwritten by incoming missed', () => {
    const store = createCalendarSyncStore();
    store.enqueueOccurrence('rem-001', '2026-07-01T08:00', 'done', new Date().toISOString());
    const id = computeOccurrenceId('rem-001', '2026-07-01T08:00');

    // Simulate a later pull delivering missed for the same id (e.g. another device
    // derived missed before it received the done sync)
    const missedOcc: ReminderOccurrenceRecord = {
      id,
      reminderId: 'rem-001',
      scheduledLocalTime: '2026-07-01T08:00',
      status: 'missed',
      version: 5, // newer version but status=missed
      createdAt: '',
      updatedAt: '',
    };
    store.upsertOccurrence(missedOcc);

    // done must survive — M1 outranks version-based LWW for missed→terminal
    expect(store.getOccurrence(id)?.status).toBe('done');
  });

  it('M1: snoozed→done is plain LWW (done wins, no M1 special case)', () => {
    const store = createCalendarSyncStore();
    store.enqueueOccurrence('rem-001', '2026-07-01T08:00', 'snoozed', new Date().toISOString());
    const id = computeOccurrenceId('rem-001', '2026-07-01T08:00');

    const doneOcc: ReminderOccurrenceRecord = {
      id,
      reminderId: 'rem-001',
      scheduledLocalTime: '2026-07-01T08:00',
      status: 'done',
      version: 5,
      createdAt: '',
      updatedAt: '',
    };
    store.upsertOccurrence(doneOcc);
    expect(store.getOccurrence(id)?.status).toBe('done');
  });

  it('getOccurrencesForReminder returns only non-tombstoned rows for that reminder', () => {
    const store = createCalendarSyncStore();
    store.enqueueOccurrence('rem-001', '2026-07-01T08:00', 'done', new Date().toISOString());
    store.enqueueOccurrence('rem-001', '2026-07-02T08:00', 'snoozed', new Date().toISOString());
    store.enqueueOccurrence('rem-002', '2026-07-01T08:00', 'done', new Date().toISOString());

    const occs = store.getOccurrencesForReminder('rem-001');
    expect(occs).toHaveLength(2);
    expect(occs.every((o) => o.reminderId === 'rem-001')).toBe(true);
  });

});

// ─── ChecklistItem tests ──────────────────────────────────────────────────────

describe('CalendarSyncStore — checklistItems', () => {

  it('enqueueCreate adds appointment to map and queue', () => {
    const store = createCalendarSyncStore();
    const item = makeChecklist();
    store.enqueueCreateChecklistItem(item);
    expect(store.getChecklistItem('ci-001')).toMatchObject({ category: 'appointment' });
    expect(store.getActiveChecklistItems()).toHaveLength(1);
  });

  it('enqueueUpdate updates locally and queues update', () => {
    const store = createCalendarSyncStore();
    store.upsertChecklistItem(makeChecklist({ version: 1 }));
    store.enqueueUpdateChecklistItem(makeChecklist({ version: 1, done: true }));
    expect(store.getChecklistItem('ci-001')?.done).toBe(true);
  });

  it('getActiveChecklistItems sorts by scheduledAt ascending', () => {
    const store = createCalendarSyncStore();
    store.upsertChecklistItem(makeChecklist({ id: 'b', scheduledAt: '2026-07-15T10:00' }));
    store.upsertChecklistItem(makeChecklist({ id: 'a', scheduledAt: '2026-07-01T08:00' }));
    const items = store.getActiveChecklistItems();
    expect(items[0].id).toBe('a');
    expect(items[1].id).toBe('b');
  });

  it('drainQueue includes checklist items in changeSet', () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateChecklistItem(makeChecklist());
    const cs = store.drainQueue();
    expect(cs.checklistItems?.created).toHaveLength(1);
    expect(store.getPendingCount()).toBe(0);
  });

});

// ─── Reset (PDPA) ─────────────────────────────────────────────────────────────

describe('CalendarSyncStore — reset (PDPA logout)', () => {

  it('reset() clears all reminders, occurrences, checklist and watermark', () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder());
    store.enqueueCreateChecklistItem(makeChecklist());
    store.enqueueOccurrence('rem-001', '2026-07-01T08:00', 'done', new Date().toISOString());
    store.setWatermark('wm-123');

    store.reset();

    expect(store.getActiveReminders()).toHaveLength(0);
    expect(store.getActiveChecklistItems()).toHaveLength(0);
    expect(store.getPendingCount()).toBe(0);
    expect(store.getWatermark()).toBeUndefined();
  });

});
