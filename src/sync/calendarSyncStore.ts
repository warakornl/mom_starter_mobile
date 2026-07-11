/**
 * CalendarSyncStore — in-memory local store for calendar-feature collections:
 *   reminders, reminderOccurrences (materialized done/snoozed), checklistItems.
 *
 * Design mirrors SyncStore (supplySyncStore pattern):
 *   - Pure in-memory (no persistence this slice; SQLite = carry-forward).
 *   - Tracks item maps, mutation queues, and the shared watermark.
 *   - De-dup by (id, version) on upsert (safe-window overlap idempotency).
 *   - Tombstones stored so IDs do not re-appear from a stale queue.
 *   - getActive* helpers filter out tombstones for display.
 *
 * FLAG-7 / W-A (occurrence push model — OQ-CAL-4 PINNED):
 *   Due occurrences are NEVER pushed — they are projected client-side from
 *   the Reminder definition via the FLAG-4 expander.
 *   Missed is derived on-device end-of-local-day and NOT pushed in MVP.
 *   enqueueOccurrence() ONLY accepts status ∈ {done, snoozed};
 *   drainQueue() filters occurrences to done/snoozed defensively.
 *
 * M1 status-merge precedence (applied on upsert):
 *   If an existing occurrence row has status ∈ {done, snoozed}, an incoming
 *   row with status=missed MUST NOT overwrite it (M1 rule).
 *   Plain LWW (by version) is used for all other status transitions.
 *
 * Security: reminder displayTitle and checklist note are non-sensitive in
 * this store (client-side plaintext; server enforces health consent gate).
 * Do NOT log health data.
 *
 * OQ-CAL-6 (orphaned occurrences): tombstoning a Reminder does NOT cascade to
 * its occurrence rows — past done/snoozed rows are retained as history.
 * The calendar renders them from the occurrence's own scheduledLocalTime,
 * falling back to a generic label when the parent Reminder is tombstoned.
 */

import type {
  ReminderRecord,
  ReminderOccurrenceRecord,
  ChecklistItemRecord,
  SyncChangeSet,
  OccurrenceStatus,
} from './syncTypes';
import { computeOccurrenceId } from '../occurrence/occurrenceId';

// ─── Terminal statuses (the only values push-accepted under W-A) ──────────────

const TERMINAL: ReadonlySet<OccurrenceStatus> = new Set(['done', 'snoozed']);

// ─── ChecklistItem mutation observer (device-calendar bridge wiring) ───────────

/**
 * Emitted by the store whenever a ChecklistItem is created, updated, or deleted
 * via the enqueue* methods. The observer wires these events to the device-calendar
 * bridge so that appointment CRUD automatically syncs to the device calendar.
 *
 * Security: the event carries the full ChecklistItemRecord (including note/title)
 * so the bridge can build the calendar payload. Do NOT log event fields; log only
 * appointmentId + op + result code (CAL-SA-50b).
 *
 * Trace: architecture §2 (reactive observer on local appointment store).
 */
export type ChecklistItemMutationEvent =
  | { type: 'create'; item: ChecklistItemRecord }
  | { type: 'update'; item: ChecklistItemRecord }
  /**
   * `item` is the pre-tombstone record (captured before deletedAt is set).
   * The listener can use item.category to skip non-appointment items (AC-2.6).
   * `item` is undefined if the id was never in the map (no-op delete path).
   */
  | { type: 'delete'; id: string; item: ChecklistItemRecord | undefined };

// ─── Interface ────────────────────────────────────────────────────────────────

export interface CalendarSyncStore {
  // ── Reminders ──────────────────────────────────────────────────────────────

  /** Active (non-tombstoned) reminders, sorted by startAt ascending. */
  getActiveReminders(): ReminderRecord[];
  /** One reminder by id (including tombstones). */
  getReminder(id: string): ReminderRecord | undefined;
  /** Upsert by (id, version) de-dup. */
  upsertReminder(item: ReminderRecord): void;
  tombstoneReminder(id: string): void;
  stampReminderApplied(id: string, version: number, updatedAt: string): void;
  adoptReminderServerRecord(record: ReminderRecord): void;

  enqueueCreateReminder(item: ReminderRecord): void;
  enqueueUpdateReminder(item: ReminderRecord): void;
  enqueueDeleteReminder(id: string): void;

  // ── ReminderOccurrences ───────────────────────────────────────────────────

  /**
   * All materialized occurrences (done/snoozed/missed) for a given reminder,
   * NOT including tombstoned rows.  `due` rows are never stored here (W-A).
   */
  getOccurrencesForReminder(reminderId: string): ReminderOccurrenceRecord[];
  /** One occurrence by id (including tombstones). */
  getOccurrence(id: string): ReminderOccurrenceRecord | undefined;
  /**
   * Upsert with M1 precedence:
   *   done/snoozed arriving for an id that already has done/snoozed is plain LWW.
   *   missed arriving for an id that already has done/snoozed is DROPPED (M1).
   */
  upsertOccurrence(occ: ReminderOccurrenceRecord): void;
  tombstoneOccurrence(id: string): void;
  stampOccurrenceApplied(id: string, version: number, updatedAt: string): void;
  adoptOccurrenceServerRecord(record: ReminderOccurrenceRecord): void;

  /**
   * Enqueue a done/snoozed occurrence for push.
   * Creates the deterministic id from (reminderId, scheduledLocalTime).
   * ONLY status ∈ {done, snoozed} is accepted (FLAG-7/W-A).
   */
  enqueueOccurrence(
    reminderId: string,
    scheduledLocalTime: string,
    status: 'done' | 'snoozed',
    actedAt: string,
    snoozedUntil?: string,
  ): void;

  // ── ChecklistItems ─────────────────────────────────────────────────────────

  /** Active (non-tombstoned) checklist items, sorted by scheduledAt ascending. */
  getActiveChecklistItems(): ChecklistItemRecord[];
  /** One checklist item by id (including tombstones). */
  getChecklistItem(id: string): ChecklistItemRecord | undefined;
  upsertChecklistItem(item: ChecklistItemRecord): void;
  tombstoneChecklistItem(id: string): void;
  stampChecklistItemApplied(id: string, version: number, updatedAt: string): void;
  adoptChecklistItemServerRecord(record: ChecklistItemRecord): void;

  enqueueCreateChecklistItem(item: ChecklistItemRecord): void;
  enqueueUpdateChecklistItem(item: ChecklistItemRecord): void;
  enqueueDeleteChecklistItem(id: string): void;

  // ── Queue / watermark ──────────────────────────────────────────────────────

  /**
   * Drain all queued mutations into a SyncChangeSet.
   * Occurrences are filtered to done/snoozed only (W-A defensive guard).
   */
  drainQueue(): SyncChangeSet;
  reEnqueueChangeset(changeSet: SyncChangeSet): void;
  getPendingCount(): number;

  /** Last adopted W1 watermark shared with the supply store. */
  getWatermark(): string | undefined;
  setWatermark(watermark: string): void;

  /** PDPA logout: clear all maps, queues, watermark. */
  reset(): void;

  /**
   * Subscribe to ChecklistItem create / update / delete mutations.
   * Returns an unsubscribe function — call it to detach the listener.
   *
   * Architecture §2: the device-calendar bridge registers here so that any
   * local write (user create/edit/delete AND pulls from server-side edits)
   * automatically propagates to the device calendar — offline-safe because
   * the trigger fires on local-store write, not on network success.
   *
   * Listener is called synchronously within the enqueue* call so it observes
   * the same JS turn. It may schedule async work (void promises) internally.
   */
  subscribeToChecklistItemMutations(
    listener: (event: ChecklistItemMutationEvent) => void,
  ): () => void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeUpsert<T extends { id: string; version: number; deletedAt?: string | null }>(
  map: Map<string, T>,
) {
  return (item: T): void => {
    const existing = map.get(item.id);
    if (
      existing &&
      existing.version > 0 &&
      item.version > 0 &&
      existing.version >= item.version
    ) {
      return;
    }
    map.set(item.id, { ...item });
  };
}

export function createCalendarSyncStore(): CalendarSyncStore {
  const reminderMap = new Map<string, ReminderRecord>();
  const occurrenceMap = new Map<string, ReminderOccurrenceRecord>();
  const checklistMap = new Map<string, ChecklistItemRecord>();

  // ── ChecklistItem mutation observers (device-calendar bridge wiring) ─────────
  // Separate Set so multiple listeners can coexist (test rig + production bridge).
  const _checklistMutationListeners = new Set<
    (event: ChecklistItemMutationEvent) => void
  >();

  function _notifyChecklistMutation(event: ChecklistItemMutationEvent): void {
    for (const listener of _checklistMutationListeners) {
      listener(event);
    }
  }

  // Pending queues
  const pendingRemindersCreated: ReminderRecord[] = [];
  const pendingRemindersUpdated: ReminderRecord[] = [];
  const pendingRemindersDeleted: string[] = [];

  const pendingOccurrencesCreated: ReminderOccurrenceRecord[] = [];
  const pendingOccurrencesUpdated: ReminderOccurrenceRecord[] = [];
  const pendingOccurrencesDeleted: string[] = [];

  const pendingChecklistCreated: ChecklistItemRecord[] = [];
  const pendingChecklistUpdated: ChecklistItemRecord[] = [];
  const pendingChecklistDeleted: string[] = [];

  let watermark: string | undefined;

  const upsertReminder = makeUpsert(reminderMap);
  const upsertOccurrenceBase = makeUpsert(occurrenceMap);
  const upsertChecklist = makeUpsert(checklistMap);

  // ── M1 precedence wrapper for occurrences ──────────────────────────────────
  function upsertOccurrenceWithM1(occ: ReminderOccurrenceRecord): void {
    const existing = occurrenceMap.get(occ.id);
    // M1: if existing is already done/snoozed, an incoming missed must not win
    if (
      existing &&
      !existing.deletedAt &&
      TERMINAL.has(existing.status) &&
      occ.status === 'missed'
    ) {
      // Drop the incoming missed — the terminal status is protected
      return;
    }
    upsertOccurrenceBase(occ);
  }

  return {
    // ── Reminders ────────────────────────────────────────────────────────────

    getActiveReminders(): ReminderRecord[] {
      return Array.from(reminderMap.values())
        .filter((r) => !r.deletedAt)
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },

    getReminder(id) {
      return reminderMap.get(id);
    },

    upsertReminder(item) {
      upsertReminder(item);
    },

    tombstoneReminder(id) {
      const existing = reminderMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        reminderMap.set(id, { ...existing, deletedAt: now });
      } else {
        // Skeleton tombstone
        reminderMap.set(id, {
          id,
          type: 'custom',
          displayTitle: '',
          recurrenceRule: { freq: 'one_off' },
          startAt: '',
          active: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    stampReminderApplied(id, version, updatedAt) {
      const existing = reminderMap.get(id);
      if (existing) reminderMap.set(id, { ...existing, version, updatedAt });
    },

    adoptReminderServerRecord(record) {
      reminderMap.set(record.id, { ...record });
    },

    enqueueCreateReminder(item) {
      reminderMap.set(item.id, { ...item });
      pendingRemindersCreated.push({ ...item });
    },

    enqueueUpdateReminder(item) {
      reminderMap.set(item.id, { ...item });
      pendingRemindersUpdated.push({ ...item });
    },

    enqueueDeleteReminder(id) {
      const existing = reminderMap.get(id);
      if (existing) {
        reminderMap.set(id, { ...existing, deletedAt: new Date().toISOString() });
      }
      pendingRemindersDeleted.push(id);
    },

    // ── ReminderOccurrences ──────────────────────────────────────────────────

    getOccurrencesForReminder(reminderId) {
      return Array.from(occurrenceMap.values()).filter(
        (o) => !o.deletedAt && o.reminderId === reminderId,
      );
    },

    getOccurrence(id) {
      return occurrenceMap.get(id);
    },

    upsertOccurrence: upsertOccurrenceWithM1,

    tombstoneOccurrence(id) {
      const existing = occurrenceMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        occurrenceMap.set(id, { ...existing, deletedAt: now });
      } else {
        occurrenceMap.set(id, {
          id,
          reminderId: '',
          scheduledLocalTime: '',
          status: 'done',
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    stampOccurrenceApplied(id, version, updatedAt) {
      const existing = occurrenceMap.get(id);
      if (existing) occurrenceMap.set(id, { ...existing, version, updatedAt });
    },

    adoptOccurrenceServerRecord(record) {
      // M1 on adopt: server record with missed must not overwrite local done/snoozed
      upsertOccurrenceWithM1({ ...record, version: record.version });
    },

    enqueueOccurrence(reminderId, scheduledLocalTime, status, actedAt, snoozedUntil) {
      // FLAG-7/W-A: only done/snoozed are push-accepted
      if (!TERMINAL.has(status)) {
        return; // defensive guard — callers should never pass due/missed
      }
      const id = computeOccurrenceId(reminderId, scheduledLocalTime);
      const existing = occurrenceMap.get(id);
      const version = existing?.version ?? 0;
      const now = new Date().toISOString();
      const occ: ReminderOccurrenceRecord = {
        id,
        reminderId: reminderId.toLowerCase(), // 🟡-3
        scheduledLocalTime,
        status,
        actedAt: actedAt ?? null,
        snoozedUntil: snoozedUntil ?? null,
        version,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };
      occurrenceMap.set(id, occ);
      if (existing) {
        pendingOccurrencesUpdated.push({ ...occ });
      } else {
        pendingOccurrencesCreated.push({ ...occ });
      }
    },

    // ── ChecklistItems ────────────────────────────────────────────────────────

    getActiveChecklistItems(): ChecklistItemRecord[] {
      return Array.from(checklistMap.values())
        .filter((c) => !c.deletedAt)
        .sort((a, b) => {
          // Sort by scheduledAt ascending; undated items last
          const sa = a.scheduledAt ?? '9999';
          const sb = b.scheduledAt ?? '9999';
          return sa.localeCompare(sb);
        });
    },

    getChecklistItem(id) {
      return checklistMap.get(id);
    },

    upsertChecklistItem(item) {
      // Capture before-state so we can detect whether makeUpsert actually wrote.
      // makeUpsert does `map.set(id, { ...item })` (new object ref) ONLY when it
      // decides to update; it returns early (no map.set) when version guard fires.
      const entryBefore = checklistMap.get(item.id);
      upsertChecklist(item);
      const entryAfter = checklistMap.get(item.id);
      // New object reference means makeUpsert wrote something (not a no-op).
      if (entryAfter && entryAfter !== entryBefore) {
        // Architecture §2: server-pull writes must also notify the bridge so that
        // pulled appointment changes propagate to the device calendar (BLOCKER 2 fix).
        if (item.category === 'appointment' && !item.deletedAt) {
          _notifyChecklistMutation({
            type: entryBefore ? 'update' : 'create',
            item: { ...entryAfter },
          });
        }
      }
    },

    tombstoneChecklistItem(id) {
      const existing = checklistMap.get(id);
      const now = new Date().toISOString();
      if (existing) {
        checklistMap.set(id, { ...existing, deletedAt: now });
      } else {
        checklistMap.set(id, {
          id,
          category: 'checklist_task',
          title: '',
          done: false,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        });
      }
    },

    stampChecklistItemApplied(id, version, updatedAt) {
      const existing = checklistMap.get(id);
      if (existing) checklistMap.set(id, { ...existing, version, updatedAt });
    },

    adoptChecklistItemServerRecord(record) {
      const wasNew = !checklistMap.has(record.id);
      checklistMap.set(record.id, { ...record });
      // Architecture §2: server-adopted records must also notify the bridge so that
      // server-pulled appointment changes reach the device calendar (BLOCKER 2 fix).
      if (record.category === 'appointment' && !record.deletedAt) {
        _notifyChecklistMutation({
          type: wasNew ? 'create' : 'update',
          item: { ...record },
        });
      }
    },

    enqueueCreateChecklistItem(item) {
      const snapshot: ChecklistItemRecord = { ...item };
      checklistMap.set(item.id, snapshot);
      pendingChecklistCreated.push(snapshot);
      // Notify observers (device-calendar bridge, architecture §2)
      _notifyChecklistMutation({ type: 'create', item: snapshot });
    },

    enqueueUpdateChecklistItem(item) {
      const snapshot: ChecklistItemRecord = { ...item };
      checklistMap.set(item.id, snapshot);
      pendingChecklistUpdated.push(snapshot);
      // Notify observers (device-calendar bridge, architecture §2)
      _notifyChecklistMutation({ type: 'update', item: snapshot });
    },

    enqueueDeleteChecklistItem(id) {
      // Capture the pre-tombstone record so the observer can inspect its category.
      const existing = checklistMap.get(id);
      if (existing) {
        checklistMap.set(id, { ...existing, deletedAt: new Date().toISOString() });
      }
      pendingChecklistDeleted.push(id);
      // Notify observers with the original (pre-tombstone) item.
      // Observer uses item.category to decide whether to call bridge (AC-2.6).
      _notifyChecklistMutation({ type: 'delete', id, item: existing });
    },

    // ── Queue / watermark ─────────────────────────────────────────────────────

    drainQueue(): SyncChangeSet {
      // FLAG-7/W-A defensive filter: only push done/snoozed occurrences
      const terminalCreated = pendingOccurrencesCreated.filter((o) => TERMINAL.has(o.status));
      const terminalUpdated = pendingOccurrencesUpdated.filter((o) => TERMINAL.has(o.status));

      const changeSet: SyncChangeSet = {
        reminders: {
          created: [...pendingRemindersCreated],
          updated: [...pendingRemindersUpdated],
          deleted: [...pendingRemindersDeleted],
        },
        reminderOccurrences: {
          created: terminalCreated,
          updated: terminalUpdated,
          deleted: [...pendingOccurrencesDeleted],
        },
        checklistItems: {
          created: [...pendingChecklistCreated],
          updated: [...pendingChecklistUpdated],
          deleted: [...pendingChecklistDeleted],
        },
      };

      pendingRemindersCreated.length = 0;
      pendingRemindersUpdated.length = 0;
      pendingRemindersDeleted.length = 0;
      pendingOccurrencesCreated.length = 0;
      pendingOccurrencesUpdated.length = 0;
      pendingOccurrencesDeleted.length = 0;
      pendingChecklistCreated.length = 0;
      pendingChecklistUpdated.length = 0;
      pendingChecklistDeleted.length = 0;

      return changeSet;
    },

    reEnqueueChangeset(changeSet) {
      if (changeSet.reminders) {
        pendingRemindersCreated.push(...changeSet.reminders.created);
        pendingRemindersUpdated.push(...changeSet.reminders.updated);
        pendingRemindersDeleted.push(...changeSet.reminders.deleted);
      }
      if (changeSet.reminderOccurrences) {
        pendingOccurrencesCreated.push(...changeSet.reminderOccurrences.created);
        pendingOccurrencesUpdated.push(...changeSet.reminderOccurrences.updated);
        pendingOccurrencesDeleted.push(...changeSet.reminderOccurrences.deleted);
      }
      if (changeSet.checklistItems) {
        pendingChecklistCreated.push(...changeSet.checklistItems.created);
        pendingChecklistUpdated.push(...changeSet.checklistItems.updated);
        pendingChecklistDeleted.push(...changeSet.checklistItems.deleted);
      }
    },

    getPendingCount(): number {
      return (
        pendingRemindersCreated.length +
        pendingRemindersUpdated.length +
        pendingRemindersDeleted.length +
        pendingOccurrencesCreated.length +
        pendingOccurrencesUpdated.length +
        pendingOccurrencesDeleted.length +
        pendingChecklistCreated.length +
        pendingChecklistUpdated.length +
        pendingChecklistDeleted.length
      );
    },

    getWatermark() {
      return watermark;
    },

    setWatermark(w) {
      watermark = w;
    },

    reset() {
      reminderMap.clear();
      occurrenceMap.clear();
      checklistMap.clear();
      pendingRemindersCreated.length = 0;
      pendingRemindersUpdated.length = 0;
      pendingRemindersDeleted.length = 0;
      pendingOccurrencesCreated.length = 0;
      pendingOccurrencesUpdated.length = 0;
      pendingOccurrencesDeleted.length = 0;
      pendingChecklistCreated.length = 0;
      pendingChecklistUpdated.length = 0;
      pendingChecklistDeleted.length = 0;
      watermark = undefined;
      // Note: _checklistMutationListeners are NOT cleared on reset.
      // Listeners are infrastructure wiring (bridge registration), not user data.
      // They survive PDPA logout so the bridge remains wired after re-login.
    },

    subscribeToChecklistItemMutations(listener) {
      _checklistMutationListeners.add(listener);
      return () => {
        _checklistMutationListeners.delete(listener);
      };
    },
  };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Module-level singleton — survives component re-mounts within one JS session.
 * Data is in-memory only; repopulated by syncClient.pull() on app launch.
 * Call reset() on logout (PDPA: prevent data leakage between sessions).
 */
export const calendarSyncStore = createCalendarSyncStore();
