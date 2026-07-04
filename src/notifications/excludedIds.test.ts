/**
 * excludedIds.test.ts — unit tests for buildExcludedIds + buildSnoozedUntilMap
 * (native-free module).
 *
 * Task 5 update:
 *   buildExcludedIds now excludes ONLY `done` occurrences. Snoozed occurrences
 *   are no longer globally excluded — they are instead rescheduled at their
 *   snoozedUntil by buildScheduleSet (approach A, Task 5). The old snoozed-
 *   exclusion tests are updated to reflect the new expected behavior.
 *
 * buildSnoozedUntilMap (new in Task 5):
 *   Returns a Map<occurrenceId, Date> for active (non-tombstoned) snoozed
 *   occurrences where snoozedUntil is in the future. Past-snoozed occurrences
 *   are omitted (the alarm already fired/was missed).
 *
 * Covers:
 *   - done occurrence → excluded (MR-AC-11: a done dose is never re-scheduled)
 *   - active snoozed occurrence → NO LONGER excluded (Task 5: rescheduled at snoozedUntil)
 *   - tombstoned / deleted occurrence → ignored (NOT excluded)
 *   - plain `due` occurrence → NOT excluded (still eligible for scheduling)
 *   - buildSnoozedUntilMap: future snoozed → in map
 *   - buildSnoozedUntilMap: past snoozed → NOT in map (alarm already fired)
 *   - buildSnoozedUntilMap: done/due → NOT in map
 *   - buildSnoozedUntilMap: tombstoned snoozed → NOT in map
 *   - buildSnoozedUntilMap: null snoozedUntil snoozed → NOT in map
 */

import { buildExcludedIds, buildSnoozedUntilMap } from './excludedIds';
import type { ReminderOccurrenceRecord } from '../sync/syncTypes';

// ─── Helper factory ───────────────────────────────────────────────────────────

function makeOcc(
  partial: Partial<ReminderOccurrenceRecord> & { id: string },
): ReminderOccurrenceRecord {
  return {
    reminderId: 'rem-001',
    scheduledLocalTime: '2026-07-05T08:00',
    status: 'due',
    actedAt: null,
    snoozedUntil: null,
    version: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    deletedAt: null,
    ...partial,
  };
}

const NOW = new Date(2026, 6, 4, 12, 0, 0, 0); // 2026-07-04T12:00 local

// ─── buildExcludedIds tests ───────────────────────────────────────────────────

describe('buildExcludedIds', () => {
  it('excludes a done occurrence (MR-AC-11: must never be re-scheduled)', () => {
    const occ = makeOcc({ id: 'occ-done', status: 'done', actedAt: '2026-07-05T08:01:00Z' });
    const result = buildExcludedIds([occ], NOW);
    expect(result.has('occ-done')).toBe(true);
    const empty = buildExcludedIds([], NOW);
    expect(empty.has('occ-done')).toBe(false);
  });

  it('does NOT exclude an active snoozed occurrence (Task 5: rescheduled at snoozedUntil)', () => {
    // Task 5 change: snoozed occurrences are NO LONGER globally excluded.
    // They are scheduled at their snoozedUntil by buildScheduleSet + buildSnoozedUntilMap.
    const snoozedUntil = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-snoozed-future',
      status: 'snoozed',
      actedAt: '2026-07-04T11:55:00Z',
      snoozedUntil,
    });
    const result = buildExcludedIds([occ], NOW);
    // snoozed is NOT excluded from the OS schedule (Task 5 approach A)
    expect(result.has('occ-snoozed-future')).toBe(false);
  });

  it('does NOT exclude a snoozed occurrence whose snoozedUntil is in the past', () => {
    // Task 5 change: buildExcludedIds no longer manages snooze alarm state.
    // buildSnoozedUntilMap handles the past/future distinction.
    const snoozedUntil = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-snoozed-past',
      status: 'snoozed',
      actedAt: '2026-07-04T08:30:00Z',
      snoozedUntil,
    });
    const result = buildExcludedIds([occ], NOW);
    // Not excluded — scheduler handles it via buildSnoozedUntilMap (past → not scheduled)
    expect(result.has('occ-snoozed-past')).toBe(false);
  });

  it('ignores a tombstoned occurrence (deletedAt set) — does NOT add to excluded set', () => {
    const occ = makeOcc({
      id: 'occ-tombstone',
      status: 'done',
      deletedAt: '2026-07-03T00:00:00Z',
    });
    const result = buildExcludedIds([occ], NOW);
    expect(result.has('occ-tombstone')).toBe(false);
  });

  it('does NOT exclude a plain due occurrence (still eligible for scheduling)', () => {
    const occ = makeOcc({ id: 'occ-due', status: 'due' });
    const result = buildExcludedIds([occ], NOW);
    expect(result.has('occ-due')).toBe(false);
  });

  it('handles a mixed list correctly — only done is excluded (Task 5: snoozed no longer excluded)', () => {
    const done = makeOcc({ id: 'occ-1', status: 'done', actedAt: '2026-07-05T08:01:00Z' });
    const snoozed = makeOcc({ id: 'occ-2', status: 'snoozed', snoozedUntil: '2026-07-05T09:00:00Z' });
    const due = makeOcc({ id: 'occ-3', status: 'due' });
    const missed = makeOcc({ id: 'occ-4', status: 'missed' });
    const tombstoned = makeOcc({ id: 'occ-5', status: 'done', deletedAt: '2026-07-01T00:00:00Z' });

    const result = buildExcludedIds([done, snoozed, due, missed, tombstoned], NOW);

    expect(result.has('occ-1')).toBe(true);  // done → excluded
    expect(result.has('occ-2')).toBe(false); // snoozed → NOT excluded (Task 5)
    expect(result.has('occ-3')).toBe(false); // due → NOT excluded
    expect(result.has('occ-4')).toBe(false); // missed → NOT excluded
    expect(result.has('occ-5')).toBe(false); // tombstoned → NOT excluded
  });

  it('returns an empty set for an empty occurrences array', () => {
    const result = buildExcludedIds([], NOW);
    expect(result.size).toBe(0);
  });
});

// ─── buildSnoozedUntilMap tests (Task 5) ─────────────────────────────────────

describe('buildSnoozedUntilMap', () => {
  it('includes an active snoozed occurrence with a future snoozedUntil', () => {
    const snoozedUntil = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-snoozed-future',
      status: 'snoozed',
      snoozedUntil,
    });
    const result = buildSnoozedUntilMap([occ], NOW);
    expect(result.has('occ-snoozed-future')).toBe(true);
    // Value is a Date matching snoozedUntil
    expect(result.get('occ-snoozed-future')!.getTime()).toBe(new Date(snoozedUntil).getTime());
  });

  it('does NOT include a snoozed occurrence whose snoozedUntil is in the past (alarm already fired)', () => {
    const snoozedUntil = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-snoozed-past',
      status: 'snoozed',
      snoozedUntil,
    });
    const result = buildSnoozedUntilMap([occ], NOW);
    expect(result.has('occ-snoozed-past')).toBe(false);
  });

  it('does NOT include a done occurrence', () => {
    const occ = makeOcc({ id: 'occ-done', status: 'done', actedAt: '2026-07-04T08:01:00Z' });
    const result = buildSnoozedUntilMap([occ], NOW);
    expect(result.has('occ-done')).toBe(false);
  });

  it('does NOT include a due occurrence', () => {
    const occ = makeOcc({ id: 'occ-due', status: 'due' });
    const result = buildSnoozedUntilMap([occ], NOW);
    expect(result.has('occ-due')).toBe(false);
  });

  it('does NOT include a tombstoned snoozed occurrence (deletedAt set)', () => {
    const snoozedUntil = new Date(NOW.getTime() + 20 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-tombstoned-snoozed',
      status: 'snoozed',
      snoozedUntil,
      deletedAt: '2026-07-03T00:00:00Z',
    });
    const result = buildSnoozedUntilMap([occ], NOW);
    expect(result.has('occ-tombstoned-snoozed')).toBe(false);
  });

  it('does NOT include a snoozed occurrence with null snoozedUntil', () => {
    const occ = makeOcc({ id: 'occ-snoozed-null', status: 'snoozed', snoozedUntil: null });
    const result = buildSnoozedUntilMap([occ], NOW);
    expect(result.has('occ-snoozed-null')).toBe(false);
  });

  it('returns an empty map for an empty occurrences array', () => {
    const result = buildSnoozedUntilMap([], NOW);
    expect(result.size).toBe(0);
  });

  it('handles a mixed list — only active snoozed with future snoozedUntil included', () => {
    const futureTime = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
    const pastTime = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();

    const snoozedFuture = makeOcc({ id: 'occ-sf', status: 'snoozed', snoozedUntil: futureTime });
    const snoozedPast   = makeOcc({ id: 'occ-sp', status: 'snoozed', snoozedUntil: pastTime });
    const snoozedNull   = makeOcc({ id: 'occ-sn', status: 'snoozed', snoozedUntil: null });
    const done          = makeOcc({ id: 'occ-d',  status: 'done' });
    const due           = makeOcc({ id: 'occ-u',  status: 'due' });
    const tombstoned    = makeOcc({ id: 'occ-t',  status: 'snoozed', snoozedUntil: futureTime, deletedAt: '2026-07-01T00:00:00Z' });

    const result = buildSnoozedUntilMap([snoozedFuture, snoozedPast, snoozedNull, done, due, tombstoned], NOW);

    expect(result.has('occ-sf')).toBe(true);  // active snoozed, future → included
    expect(result.has('occ-sp')).toBe(false); // past snoozedUntil → excluded
    expect(result.has('occ-sn')).toBe(false); // null snoozedUntil → excluded
    expect(result.has('occ-d')).toBe(false);  // done → excluded
    expect(result.has('occ-u')).toBe(false);  // due → excluded
    expect(result.has('occ-t')).toBe(false);  // tombstoned → excluded
  });
});
