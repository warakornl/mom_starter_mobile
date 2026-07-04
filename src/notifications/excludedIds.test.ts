/**
 * excludedIds.test.ts — unit tests for buildExcludedIds (native-free module).
 *
 * This file imports ONLY from excludedIds.ts (no expo-notifications, no native
 * module) and is safe to run in the Node.js Jest environment without a device.
 *
 * Covers Fix I-2 requirements:
 *   - done occurrence → excluded (MR-AC-11: a done dose is never re-scheduled)
 *   - active snoozed occurrence → excluded (original alarm cancelled; Task 5 deferred)
 *   - tombstoned / deleted occurrence → ignored (NOT excluded)
 *   - plain `due` occurrence → NOT excluded (still eligible for scheduling)
 */

import { buildExcludedIds } from './excludedIds';
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildExcludedIds', () => {
  it('excludes a done occurrence (MR-AC-11: must never be re-scheduled)', () => {
    const occ = makeOcc({ id: 'occ-done', status: 'done', actedAt: '2026-07-05T08:01:00Z' });
    const result = buildExcludedIds([occ], NOW);
    expect(result.has('occ-done')).toBe(true);
    // Verify it WOULD fail if the mapping were removed — only done→excluded is asserted
    const empty = buildExcludedIds([], NOW);
    expect(empty.has('occ-done')).toBe(false);
  });

  it('excludes an active snoozed occurrence (snoozedUntil in the future)', () => {
    // snoozedUntil is 30 min after NOW — the occurrence is still "sleeping"
    const snoozedUntil = new Date(NOW.getTime() + 30 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-snoozed-future',
      status: 'snoozed',
      actedAt: '2026-07-04T11:55:00Z',
      snoozedUntil,
    });
    const result = buildExcludedIds([occ], NOW);
    expect(result.has('occ-snoozed-future')).toBe(true);
  });

  it('excludes a snoozed occurrence whose snoozedUntil is in the past (snooze alarm already fired/missed)', () => {
    // snoozedUntil is 5 minutes before NOW
    const snoozedUntil = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    const occ = makeOcc({
      id: 'occ-snoozed-past',
      status: 'snoozed',
      actedAt: '2026-07-04T08:30:00Z',
      snoozedUntil,
    });
    const result = buildExcludedIds([occ], NOW);
    // Both past and future snoozed are excluded (single branch — no dead else)
    expect(result.has('occ-snoozed-past')).toBe(true);
  });

  it('ignores a tombstoned occurrence (deletedAt set) — does NOT add to excluded set', () => {
    const occ = makeOcc({
      id: 'occ-tombstone',
      status: 'done', // would normally be excluded, but tombstoned → ignored
      deletedAt: '2026-07-03T00:00:00Z',
    });
    const result = buildExcludedIds([occ], NOW);
    // tombstoned occurrence must NOT be in the excluded set
    expect(result.has('occ-tombstone')).toBe(false);
  });

  it('does NOT exclude a plain due occurrence (still eligible for scheduling)', () => {
    const occ = makeOcc({ id: 'occ-due', status: 'due' });
    const result = buildExcludedIds([occ], NOW);
    expect(result.has('occ-due')).toBe(false);
  });

  it('handles a mixed list correctly — only done/snoozed are excluded', () => {
    const done = makeOcc({ id: 'occ-1', status: 'done', actedAt: '2026-07-05T08:01:00Z' });
    const snoozed = makeOcc({ id: 'occ-2', status: 'snoozed', snoozedUntil: '2026-07-05T09:00:00Z' });
    const due = makeOcc({ id: 'occ-3', status: 'due' });
    const missed = makeOcc({ id: 'occ-4', status: 'missed' });
    const tombstoned = makeOcc({ id: 'occ-5', status: 'done', deletedAt: '2026-07-01T00:00:00Z' });

    const result = buildExcludedIds([done, snoozed, due, missed, tombstoned], NOW);

    expect(result.has('occ-1')).toBe(true);  // done → excluded
    expect(result.has('occ-2')).toBe(true);  // snoozed → excluded
    expect(result.has('occ-3')).toBe(false); // due → NOT excluded
    expect(result.has('occ-4')).toBe(false); // missed → NOT excluded
    expect(result.has('occ-5')).toBe(false); // tombstoned → NOT excluded
  });

  it('returns an empty set for an empty occurrences array', () => {
    const result = buildExcludedIds([], NOW);
    expect(result.size).toBe(0);
  });
});
