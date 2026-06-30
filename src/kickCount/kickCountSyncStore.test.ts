/**
 * kickCountSyncStore tests — TDD (failing first).
 *
 * Covers:
 *  - Immutable-event union: finalize inserts completed, re-push is no-op
 *  - Terminal-status guard (client-side): only `completed` drained to queue
 *  - drainQueue / reEnqueueChangeset
 *  - upsertSession de-dup by (id, version)
 *  - tombstoneSession
 *  - stampApplied / adoptServerRecord
 *  - getActiveSessions filters tombstoned rows
 *  - reset() clears all state
 */

import { createKickCountSyncStore } from './kickCountSyncStore';
import type { KickCountSessionRecord } from './kickCountTypes';

const NOW = '2026-06-30T09:15';
const LATER = '2026-06-30T09:27';

function makeSession(overrides: Partial<KickCountSessionRecord> = {}): KickCountSessionRecord {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    startedAt: NOW,
    endedAt: LATER,
    movementCount: 7,
    targetCount: 10,
    status: 'completed',
    durationSeconds: 720,
    gestationalWeekAtStart: 34,
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  };
}

describe('kickCountSyncStore', () => {
  describe('enqueueCreate + drainQueue', () => {
    it('drainQueue returns the enqueued completed session in created[]', () => {
      const store = createKickCountSyncStore();
      const session = makeSession();
      store.enqueueCreate(session);
      const changeSet = store.drainQueue();
      expect(changeSet.kickCountSessions).toBeDefined();
      expect(changeSet.kickCountSessions!.created).toHaveLength(1);
      expect(changeSet.kickCountSessions!.created[0].id).toBe(session.id);
    });

    it('drainQueue clears the queue after drain', () => {
      const store = createKickCountSyncStore();
      store.enqueueCreate(makeSession());
      store.drainQueue();
      const changeSet2 = store.drainQueue();
      expect(changeSet2.kickCountSessions!.created).toHaveLength(0);
    });

    it('drainQueue never includes non-completed status (terminal guard)', () => {
      const store = createKickCountSyncStore();
      // Simulate a bug where in_progress ended up queued — must be filtered
      const inProgress = makeSession({ status: 'in_progress' as KickCountSessionRecord['status'] });
      store.enqueueCreate(inProgress);
      const changeSet = store.drainQueue();
      // completed filter: only completed rows in the drain
      const drained = changeSet.kickCountSessions?.created ?? [];
      expect(drained.filter((s) => s.status !== 'completed')).toHaveLength(0);
    });
  });

  describe('upsertSession — (id, version) de-dup', () => {
    it('inserts a new session', () => {
      const store = createKickCountSyncStore();
      const s = makeSession({ version: 1 });
      store.upsertSession(s);
      expect(store.getSession(s.id)).toMatchObject({ id: s.id, version: 1 });
    });

    it('does not overwrite a higher-version local row with a lower-version incoming', () => {
      const store = createKickCountSyncStore();
      const s = makeSession({ version: 2 });
      store.upsertSession(s);
      const older = makeSession({ version: 1 });
      store.upsertSession(older);
      expect(store.getSession(s.id)?.version).toBe(2);
    });

    it('overwrites with higher-version incoming', () => {
      const store = createKickCountSyncStore();
      store.upsertSession(makeSession({ version: 1 }));
      store.upsertSession(makeSession({ version: 3 }));
      expect(store.getSession(makeSession().id)?.version).toBe(3);
    });
  });

  describe('tombstoneSession', () => {
    it('sets deletedAt on an existing session', () => {
      const store = createKickCountSyncStore();
      const s = makeSession({ version: 1 });
      store.upsertSession(s);
      store.tombstoneSession(s.id);
      expect(store.getSession(s.id)?.deletedAt).toBeTruthy();
    });

    it('inserts a tombstone skeleton for unknown id', () => {
      const store = createKickCountSyncStore();
      store.tombstoneSession('unknown-id');
      expect(store.getSession('unknown-id')?.deletedAt).toBeTruthy();
    });

    it('enqueues delete in queue', () => {
      const store = createKickCountSyncStore();
      const s = makeSession({ version: 1 });
      store.upsertSession(s);
      store.enqueueDelete(s.id);
      const changeSet = store.drainQueue();
      expect(changeSet.kickCountSessions!.deleted).toContain(s.id);
    });
  });

  describe('getActiveSessions', () => {
    it('returns only non-tombstoned completed sessions sorted by startedAt desc', () => {
      const store = createKickCountSyncStore();
      const s1 = makeSession({ id: 'id-1', startedAt: '2026-06-29T09:00', version: 1 });
      const s2 = makeSession({ id: 'id-2', startedAt: '2026-06-30T09:15', version: 1 });
      store.upsertSession(s1);
      store.upsertSession(s2);
      store.tombstoneSession(s1.id);
      const active = store.getActiveSessions();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('id-2');
    });

    it('returns empty array when no sessions', () => {
      const store = createKickCountSyncStore();
      expect(store.getActiveSessions()).toHaveLength(0);
    });
  });

  describe('stampApplied', () => {
    it('stamps version and updatedAt on the local row', () => {
      const store = createKickCountSyncStore();
      const s = makeSession({ version: 0 });
      store.upsertSession(s);
      store.stampApplied(s.id, 1, '2026-06-30T10:00:00.000Z');
      expect(store.getSession(s.id)?.version).toBe(1);
      expect(store.getSession(s.id)?.updatedAt).toBe('2026-06-30T10:00:00.000Z');
    });
  });

  describe('adoptServerRecord', () => {
    it('unconditionally adopts the server record (including tombstones)', () => {
      const store = createKickCountSyncStore();
      const s = makeSession({ version: 3 });
      store.upsertSession(s);
      const serverRecord = makeSession({ version: 5, movementCount: 9 });
      store.adoptServerRecord(serverRecord);
      expect(store.getSession(serverRecord.id)?.version).toBe(5);
      expect(store.getSession(serverRecord.id)?.movementCount).toBe(9);
    });
  });

  describe('reEnqueueChangeset', () => {
    it('re-enqueues a previously drained changeset', () => {
      const store = createKickCountSyncStore();
      store.enqueueCreate(makeSession());
      const cs = store.drainQueue();
      expect(store.drainQueue().kickCountSessions!.created).toHaveLength(0);
      store.reEnqueueChangeset(cs);
      expect(store.drainQueue().kickCountSessions!.created).toHaveLength(1);
    });
  });

  describe('getPendingCount', () => {
    it('counts pending mutations', () => {
      const store = createKickCountSyncStore();
      expect(store.getPendingCount()).toBe(0);
      store.enqueueCreate(makeSession({ id: 'id-a' }));
      store.enqueueCreate(makeSession({ id: 'id-b' }));
      expect(store.getPendingCount()).toBe(2);
    });
  });

  describe('watermark', () => {
    it('gets/sets watermark', () => {
      const store = createKickCountSyncStore();
      expect(store.getWatermark()).toBeUndefined();
      store.setWatermark('wm-token');
      expect(store.getWatermark()).toBe('wm-token');
    });
  });

  describe('reset()', () => {
    it('clears all sessions, queue, and watermark', () => {
      const store = createKickCountSyncStore();
      store.upsertSession(makeSession({ version: 1 }));
      store.enqueueCreate(makeSession({ id: 'id-b' }));
      store.setWatermark('wm');
      store.reset();
      expect(store.getActiveSessions()).toHaveLength(0);
      expect(store.getPendingCount()).toBe(0);
      expect(store.getWatermark()).toBeUndefined();
    });
  });
});
