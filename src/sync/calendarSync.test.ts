/**
 * Calendar sync integration tests — TDD (failing until implementation lands).
 *
 * Tests cover the three issues raised by mobile-reviewer (🔴-1):
 *
 *  A. syncClient generic collection routing:
 *     - applied[] for reminders/reminderOccurrences/checklistItems must route
 *       to CalendarSyncStore (not silently dropped like the old supplyItems guard)
 *     - conflicts[] same routing
 *     - pull changes for all calendar collections reach the store
 *
 *  B. Push trigger on save:
 *     executePush with CalendarSyncStore must drain + push correctly
 *
 *  C. Rejected re-enqueue for calendar collections:
 *     executePush must re-enqueue rejected reminders/occurrences/checklistItems
 *     (not only supplyItems as in the old implementation)
 */

import { createCalendarSyncClient } from './syncClient';
import { createCalendarSyncStore } from './calendarSyncStore';
import { executePush } from './pushOrchestrator';
import { computeOccurrenceId } from '../occurrence/occurrenceId';
import type { FetchFn } from '../auth/authApiClient';
import type {
  ReminderRecord,
  ReminderOccurrenceRecord,
  ChecklistItemRecord,
  AppliedRecord,
  ConflictRecord,
  RejectedRecord,
} from './syncTypes';

// ─── Test helpers ──────────────────────────────────────────────────────────────

const BASE = 'http://localhost:8080';
const TOKEN = 'test.calendar.token';
const IDEM = 'idem-cal-1';
const WATERMARK = '2026-06-30T00:00:00Z';

function mockFetch(status: number, body?: unknown): FetchFn {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: () => Promise.resolve(body ?? {}),
    } as unknown as Response);
}

function makePushResponse(overrides: {
  applied?: AppliedRecord[];
  conflicts?: ConflictRecord[];
  rejected?: RejectedRecord[];
}) {
  return {
    timestamp: WATERMARK,
    applied: overrides.applied ?? [],
    conflicts: overrides.conflicts ?? [],
    rejected: overrides.rejected ?? [],
  };
}

function makeReminder(partial: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: 'rem-test-1',
    type: 'custom',
    displayTitle: 'Test reminder',
    recurrenceRule: { freq: 'daily', timesOfDay: ['08:00'] },
    startAt: '2026-07-01T08:00',
    active: true,
    version: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...partial,
  };
}

function makeOccurrence(partial: Partial<ReminderOccurrenceRecord> = {}): ReminderOccurrenceRecord {
  return {
    id: computeOccurrenceId('rem-test-1', '2026-07-01T08:00'),
    reminderId: 'rem-test-1',
    scheduledLocalTime: '2026-07-01T08:00',
    status: 'done',
    actedAt: '2026-07-01T08:05:00Z',
    version: 1,
    createdAt: '2026-07-01T08:05:00Z',
    updatedAt: '2026-07-01T08:05:00Z',
    ...partial,
  };
}

function makeChecklist(partial: Partial<ChecklistItemRecord> = {}): ChecklistItemRecord {
  return {
    id: 'ci-test-1',
    category: 'appointment',
    title: 'ANC Visit',
    scheduledAt: '2026-07-10T09:00',
    done: false,
    version: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...partial,
  };
}

// ─── A. syncClient generic routing — applied[] ────────────────────────────────

describe('createCalendarSyncClient.push — applied[] routing', () => {
  it('stamps reminders applied[] on calendarSyncStore', async () => {
    const store = createCalendarSyncStore();
    const rem = makeReminder({ version: 1 });
    store.upsertReminder(rem);

    const pushResp = makePushResponse({
      applied: [{ collection: 'reminders', id: 'rem-test-1', version: 2, updatedAt: '2026-07-01T10:00:00Z' }],
    });

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    const changes = { reminders: { created: [], updated: [rem], deleted: [] } };
    const result = await client.push(changes, '', TOKEN);

    expect(result.ok).toBe(true);
    const stored = store.getReminder('rem-test-1');
    // Contract §2: client MUST stamp applied version
    expect(stored?.version).toBe(2);
    expect(stored?.updatedAt).toBe('2026-07-01T10:00:00Z');
  });

  it('stamps reminderOccurrences applied[] on calendarSyncStore', async () => {
    const store = createCalendarSyncStore();
    const occ = makeOccurrence({ version: 1 });
    store.upsertOccurrence(occ);

    const pushResp = makePushResponse({
      applied: [{ collection: 'reminderOccurrences', id: occ.id, version: 3, updatedAt: '2026-07-01T09:00:00Z' }],
    });

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    const result = await client.push({ reminderOccurrences: { created: [], updated: [occ], deleted: [] } }, '', TOKEN);

    expect(result.ok).toBe(true);
    const stored = store.getOccurrence(occ.id);
    expect(stored?.version).toBe(3);
    expect(stored?.updatedAt).toBe('2026-07-01T09:00:00Z');
  });

  it('stamps checklistItems applied[] on calendarSyncStore', async () => {
    const store = createCalendarSyncStore();
    const ci = makeChecklist({ version: 1 });
    store.upsertChecklistItem(ci);

    const pushResp = makePushResponse({
      applied: [{ collection: 'checklistItems', id: 'ci-test-1', version: 4, updatedAt: '2026-07-01T11:00:00Z' }],
    });

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    const result = await client.push({ checklistItems: { created: [], updated: [ci], deleted: [] } }, '', TOKEN);

    expect(result.ok).toBe(true);
    const stored = store.getChecklistItem('ci-test-1');
    expect(stored?.version).toBe(4);
    expect(stored?.updatedAt).toBe('2026-07-01T11:00:00Z');
  });

  it('does NOT mutate calendarSyncStore for unknown collection in applied[]', async () => {
    // Unknown collection must be silently ignored (no crash)
    const store = createCalendarSyncStore();
    const pushResp = makePushResponse({
      applied: [{ collection: 'unknownCollection', id: 'x', version: 5, updatedAt: 'now' }],
    });
    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    const result = await client.push({}, '', TOKEN);
    expect(result.ok).toBe(true);
    // No crash — store is unchanged
    expect(store.getActiveReminders()).toHaveLength(0);
  });
});

// ─── A. syncClient generic routing — conflicts[] ──────────────────────────────

describe('createCalendarSyncClient.push — conflicts[] routing', () => {
  it('adopts serverRecord for reminders conflict (server_won)', async () => {
    const store = createCalendarSyncStore();
    const localRem = makeReminder({ version: 1, displayTitle: 'old title' });
    store.upsertReminder(localRem);

    const serverRecord = makeReminder({ version: 3, displayTitle: 'server title' });
    const pushResp = makePushResponse({
      conflicts: [{ collection: 'reminders', id: 'rem-test-1', resolution: 'server_won', serverRecord }],
    });

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    await client.push({ reminders: { created: [], updated: [localRem], deleted: [] } }, '', TOKEN);

    const stored = store.getReminder('rem-test-1');
    expect(stored?.displayTitle).toBe('server title');
    expect(stored?.version).toBe(3);
  });

  it('adopts serverRecord for checklistItems conflict (tombstone_won)', async () => {
    const store = createCalendarSyncStore();
    const localCi = makeChecklist({ version: 1 });
    store.upsertChecklistItem(localCi);

    const tombstone: ChecklistItemRecord = {
      ...localCi,
      version: 5,
      deletedAt: '2026-07-01T08:00:00Z',
    };
    const pushResp = makePushResponse({
      conflicts: [{ collection: 'checklistItems', id: 'ci-test-1', resolution: 'tombstone_won', serverRecord: tombstone }],
    });

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    await client.push({ checklistItems: { created: [], updated: [localCi], deleted: [] } }, '', TOKEN);

    const stored = store.getChecklistItem('ci-test-1');
    expect(stored?.deletedAt).toBeTruthy();
    // Tombstone must not appear in active list
    expect(store.getActiveChecklistItems()).toHaveLength(0);
  });
});

// ─── A. syncClient generic routing — pull ────────────────────────────────────

describe('createCalendarSyncClient.pull — applies calendar collections', () => {
  it('upserts reminders from pull updated[]', async () => {
    const store = createCalendarSyncStore();
    const rem = makeReminder({ version: 2 });

    const pullResp = {
      timestamp: WATERMARK,
      hasMore: false,
      changes: { reminders: { created: [], updated: [rem], deleted: [] } },
    };

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pullResp));
    const result = await client.pull(TOKEN);

    expect(result.ok).toBe(true);
    expect(store.getActiveReminders()).toHaveLength(1);
    expect(store.getReminder('rem-test-1')?.version).toBe(2);
  });

  it('upserts checklistItems from pull created[]', async () => {
    const store = createCalendarSyncStore();
    const ci = makeChecklist({ version: 1 });

    const pullResp = {
      timestamp: WATERMARK,
      hasMore: false,
      changes: { checklistItems: { created: [ci], updated: [], deleted: [] } },
    };

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pullResp));
    await client.pull(TOKEN);

    expect(store.getActiveChecklistItems()).toHaveLength(1);
    expect(store.getChecklistItem('ci-test-1')).toBeDefined();
  });

  it('tombstones reminders from pull deleted[]', async () => {
    const store = createCalendarSyncStore();
    store.upsertReminder(makeReminder({ version: 1 }));

    const pullResp = {
      timestamp: WATERMARK,
      hasMore: false,
      changes: { reminders: { created: [], updated: [], deleted: ['rem-test-1'] } },
    };

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pullResp));
    await client.pull(TOKEN);

    expect(store.getActiveReminders()).toHaveLength(0);
    expect(store.getReminder('rem-test-1')?.deletedAt).toBeTruthy();
  });

  it('upserts occurrences from pull updated[]', async () => {
    const store = createCalendarSyncStore();
    const occ = makeOccurrence({ version: 2 });

    const pullResp = {
      timestamp: WATERMARK,
      hasMore: false,
      changes: { reminderOccurrences: { created: [], updated: [occ], deleted: [] } },
    };

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pullResp));
    await client.pull(TOKEN);

    expect(store.getOccurrence(occ.id)?.version).toBe(2);
    expect(store.getOccurrence(occ.id)?.status).toBe('done');
  });

  it('adopts watermark on last pull page', async () => {
    const store = createCalendarSyncStore();

    const pullResp = {
      timestamp: WATERMARK,
      hasMore: false,
      changes: {},
    };

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pullResp));
    await client.pull(TOKEN);

    expect(store.getWatermark()).toBe(WATERMARK);
  });

  it('pulls multiple collections in one page', async () => {
    const store = createCalendarSyncStore();
    const rem = makeReminder({ version: 1 });
    const ci = makeChecklist({ version: 1 });

    const pullResp = {
      timestamp: WATERMARK,
      hasMore: false,
      changes: {
        reminders: { created: [rem], updated: [], deleted: [] },
        checklistItems: { created: [ci], updated: [], deleted: [] },
      },
    };

    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pullResp));
    await client.pull(TOKEN);

    expect(store.getActiveReminders()).toHaveLength(1);
    expect(store.getActiveChecklistItems()).toHaveLength(1);
  });
});

// ─── B. Push trigger — executePush with CalendarSyncStore ─────────────────────

describe('executePush — works with CalendarSyncStore', () => {
  it('drains calendarSyncStore queue and pushes reminders', async () => {
    const store = createCalendarSyncStore();
    const rem = makeReminder({ version: 0 });
    store.enqueueCreateReminder(rem);

    expect(store.getPendingCount()).toBe(1);

    const pushResp = makePushResponse({
      applied: [{ collection: 'reminders', id: 'rem-test-1', version: 1, updatedAt: 'now' }],
    });
    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(true);
    // After successful push, queue is empty
    expect(store.getPendingCount()).toBe(0);
  });

  it('re-enqueues calendar changeset on push fail (500)', async () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder({ version: 0 }));
    store.enqueueCreateChecklistItem(makeChecklist({ version: 0 }));

    expect(store.getPendingCount()).toBe(2);

    const client = createCalendarSyncClient(
      BASE,
      store,
      mockFetch(500, { code: 'server_error', message: 'Internal Server Error' }),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(false);
    // Both mutations must survive — not silently lost
    expect(store.getPendingCount()).toBe(2);
  });

  it('re-enqueues calendar changeset on network/403 fail', async () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder({ version: 0 }));

    const client = createCalendarSyncClient(
      BASE,
      store,
      mockFetch(403, { code: 'consent_required', message: 'Forbidden' }),
    );
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(false);
    expect(store.getPendingCount()).toBe(1);
  });
});

// ─── C. Rejected re-enqueue for calendar collections ─────────────────────────

describe('executePush — rejected[] re-enqueue for calendar collections', () => {
  it('re-enqueues rejected reminder by id', async () => {
    const store = createCalendarSyncStore();
    const remA = makeReminder({ id: 'rem-A', version: 0 });
    const remB = makeReminder({ id: 'rem-B', version: 0 });
    store.enqueueCreateReminder(remA);
    store.enqueueCreateReminder(remB);

    const pushResp = makePushResponse({
      applied: [{ collection: 'reminders', id: 'rem-B', version: 1, updatedAt: 'now' }],
      rejected: [{ collection: 'reminders', id: 'rem-A', code: 'validation_error', details: 'title empty' }],
    });
    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    const result = await executePush(store, client, TOKEN, IDEM);

    expect(result.ok).toBe(true);
    // rem-A rejected → must stay in queue; rem-B applied → must not re-queue
    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues rejected checklistItem by id', async () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateChecklistItem(makeChecklist({ id: 'ci-rej', version: 0 }));

    const pushResp = makePushResponse({
      rejected: [{ collection: 'checklistItems', id: 'ci-rej', code: 'validation_error' }],
    });
    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    await executePush(store, client, TOKEN, IDEM);

    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues rejected occurrence by id', async () => {
    const store = createCalendarSyncStore();
    store.enqueueOccurrence('rem-test-1', '2026-07-01T08:00', 'done', new Date().toISOString());
    const occId = computeOccurrenceId('rem-test-1', '2026-07-01T08:00');

    expect(store.getPendingCount()).toBe(1);

    const pushResp = makePushResponse({
      rejected: [{ collection: 'reminderOccurrences', id: occId, code: 'validation_error', details: 'non_terminal_status' }],
    });
    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    await executePush(store, client, TOKEN, IDEM);

    // Rejected occurrence must remain in queue for retry
    expect(store.getPendingCount()).toBe(1);
  });

  it('re-enqueues entire changeset on whole-collection rejection (no id)', async () => {
    const store = createCalendarSyncStore();
    store.enqueueCreateReminder(makeReminder({ version: 0 }));
    store.enqueueCreateChecklistItem(makeChecklist({ version: 0 }));

    const pushResp = makePushResponse({
      // No id → whole-collection rejection (consent_required for health data)
      rejected: [{ collection: 'reminders', code: 'consent_required' }],
    });
    const client = createCalendarSyncClient(BASE, store, mockFetch(200, pushResp));
    await executePush(store, client, TOKEN, IDEM);

    // All mutations must be re-queued
    expect(store.getPendingCount()).toBe(2);
  });
});
