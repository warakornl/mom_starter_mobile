/**
 * feedingAgenda.test.ts — TDD tests for getFeedingSessionsForDate.
 *
 * Written BEFORE implementation (RED phase).
 *
 * Bug fix (owner report "บันทึกการให้นมไม่ขึ้นในปฏิทิน" — feeding log doesn't
 * appear in the calendar). Root cause: feedingSessionStore was never read by
 * CalendarScreen at all — no CalendarItem kind, no agenda row, nothing. This
 * mirrors kickCountAgenda.ts (the shipped precedent for surfacing an
 * independent local session store on the calendar's selected-day agenda).
 *
 * Covers:
 *  - sessions-on-date filtering
 *  - civil-date mapping across a day boundary (tz-stable floating-civil, FLAG-1)
 *  - empty case
 *  - multi-session sort by time (ascending)
 *  - view-model shape: { id, timeLabel, kind }
 *  - injectable toCivilDate param mirrors how CalendarScreen uses bucketCivilDay
 *
 * Security: tests NEVER log amountSubUnits or any feeding value (MOTHER-health K-8).
 */

import { getFeedingSessionsForDate } from './feedingAgenda';
import type { FeedingSessionRecord } from '../sync/syncTypes';

// ─── Test fixture factory ─────────────────────────────────────────────────────

function makeSession(
  id: string,
  startedAt: string,
  overrides?: Partial<FeedingSessionRecord>,
): FeedingSessionRecord {
  return {
    id,
    kind: 'breastfeed',
    startedAt,
    version: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  } as FeedingSessionRecord;
}

/** Stub toCivilDate — mirrors what bucketCivilDay does: slice(0,10). */
const sliceToCivil = (ts: string): string => ts.slice(0, 10);

// ─── Empty case ───────────────────────────────────────────────────────────────

describe('getFeedingSessionsForDate — empty case', () => {
  it('returns an empty array when no sessions', () => {
    expect(getFeedingSessionsForDate([], '2026-07-05', sliceToCivil)).toEqual([]);
  });

  it('returns empty array when no session falls on selectedDate', () => {
    const sessions = [makeSession('s1', '2026-07-06T10:00')];
    expect(getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil)).toEqual([]);
  });
});

// ─── Date filtering ───────────────────────────────────────────────────────────

describe('getFeedingSessionsForDate — date filtering', () => {
  it('returns only sessions whose civil date matches selectedDate', () => {
    const sessions = [
      makeSession('a1', '2026-07-05T10:00'),
      makeSession('a2', '2026-07-06T09:30'),
      makeSession('a3', '2026-07-05T14:00'),
    ];
    const result = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('a3');
    expect(ids).not.toContain('a2');
  });

  it('uses the injected toCivilDate function for bucketing', () => {
    const sessions = [makeSession('b1', '2026-07-05T10:00')];
    const called: string[] = [];
    const spy = (ts: string): string => {
      called.push(ts);
      return ts.slice(0, 10);
    };
    getFeedingSessionsForDate(sessions, '2026-07-05', spy);
    expect(called).toContain('2026-07-05T10:00');
  });

  it('excludes tombstoned sessions (deletedAt set) — immutable-event soft-delete', () => {
    const sessions = [
      makeSession('live', '2026-07-05T10:00'),
      makeSession('gone', '2026-07-05T11:00', { deletedAt: '2026-07-05T12:00:00.000Z' }),
    ];
    const result = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result.map((r) => r.id)).toEqual(['live']);
  });
});

// ─── Civil-date day boundary (FLAG-1: tz-stable floating-civil) ──────────────

describe('getFeedingSessionsForDate — day boundary (FLAG-1)', () => {
  it('23:30 session stays on its civil date — does NOT roll into next day', () => {
    const sessions = [makeSession('late', '2026-07-05T23:30')];
    const onDate = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(onDate).toHaveLength(1);
    expect(onDate[0].id).toBe('late');
    const nextDay = getFeedingSessionsForDate(sessions, '2026-07-06', sliceToCivil);
    expect(nextDay).toHaveLength(0);
  });

  it('00:00 session stays on its civil date — does NOT roll into previous day', () => {
    const sessions = [makeSession('early', '2026-07-06T00:00')];
    const onDate = getFeedingSessionsForDate(sessions, '2026-07-06', sliceToCivil);
    expect(onDate).toHaveLength(1);
    const prevDay = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(prevDay).toHaveLength(0);
  });
});

// ─── Sort order ───────────────────────────────────────────────────────────────

describe('getFeedingSessionsForDate — sort order', () => {
  it('sorts multiple sessions on the same day by startedAt ascending', () => {
    const sessions = [
      makeSession('c2', '2026-07-05T14:00'),
      makeSession('c1', '2026-07-05T09:00'),
      makeSession('c3', '2026-07-05T20:30'),
    ];
    const result = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('c1');
    expect(result[1].id).toBe('c2');
    expect(result[2].id).toBe('c3');
  });
});

// ─── View-model shape ─────────────────────────────────────────────────────────

describe('getFeedingSessionsForDate — view-model', () => {
  it('returns { id, timeLabel, kind } for each matching session', () => {
    const sessions = [makeSession('d1', '2026-07-05T10:30', { kind: 'pump' })];
    const result = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'd1',
      timeLabel: '10:30',
      kind: 'pump',
    });
  });

  it('timeLabel is the HH:mm slice of startedAt (matches CalendarScreen time display pattern)', () => {
    const sessions = [makeSession('d2', '2026-07-05T07:05')];
    const [item] = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(item.timeLabel).toBe('07:05');
  });

  it('never includes amountSubUnits/volumeMl/durationSeconds in the view model (K-8)', () => {
    const sessions = [
      makeSession('d3', '2026-07-05T11:00', {
        kind: 'formula',
        amountSubUnits: 2,
        volumeMl: 90,
        durationSeconds: 600,
      } as Partial<FeedingSessionRecord>),
    ];
    const [item] = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(Object.keys(item).sort()).toEqual(['id', 'kind', 'timeLabel']);
  });

  it('kind=formula/breastfeed/pump are all valid view-model kinds', () => {
    const sessions = [
      makeSession('f1', '2026-07-05T09:00', { kind: 'formula' }),
      makeSession('f2', '2026-07-05T10:00', { kind: 'breastfeed' }),
      makeSession('f3', '2026-07-05T11:00', { kind: 'pump' }),
    ];
    const result = getFeedingSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result.map((r) => r.kind)).toEqual(['formula', 'breastfeed', 'pump']);
  });
});
