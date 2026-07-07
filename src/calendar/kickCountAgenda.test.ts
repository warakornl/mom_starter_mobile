/**
 * kickCountAgenda.test.ts — TDD tests for getKickCountSessionsForDate.
 *
 * Written BEFORE implementation (RED phase).
 *
 * Covers:
 *  - sessions-on-date filtering
 *  - civil-date mapping across a day boundary (tz-stable floating-civil)
 *  - empty case
 *  - multi-session sort by time (ascending)
 *  - view-model shape: { id, timeLabel, movementCount }
 *  - injectable toCivilDate param mirrors how CalendarScreen uses bucketCivilDay
 *
 * Security: tests NEVER log movementCount or session fields (MOTHER-health K-8).
 */

import { getKickCountSessionsForDate } from './kickCountAgenda';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';

// ─── Test fixture factory ─────────────────────────────────────────────────────

function makeSession(
  id: string,
  startedAt: string,
  movementCount: number,
  overrides?: Partial<KickCountSessionRecord>,
): KickCountSessionRecord {
  return {
    id,
    startedAt,
    movementCount,
    targetCount: 10,
    status: 'completed',
    version: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Stub toCivilDate — mirrors what bucketCivilDay does: slice(0,10). */
const sliceToCivil = (ts: string): string => ts.slice(0, 10);

// ─── Empty case ───────────────────────────────────────────────────────────────

describe('getKickCountSessionsForDate — empty case', () => {
  it('returns an empty array when no sessions', () => {
    expect(getKickCountSessionsForDate([], '2026-07-05', sliceToCivil)).toEqual([]);
  });

  it('returns empty array when no session falls on selectedDate', () => {
    const sessions = [
      makeSession('s1', '2026-07-06T10:00', 5),
    ];
    expect(getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil)).toEqual([]);
  });
});

// ─── Date filtering ───────────────────────────────────────────────────────────

describe('getKickCountSessionsForDate — date filtering', () => {
  it('returns only sessions whose civil date matches selectedDate', () => {
    const sessions = [
      makeSession('a1', '2026-07-05T10:00', 7),
      makeSession('a2', '2026-07-06T09:30', 5),
      makeSession('a3', '2026-07-05T14:00', 3),
    ];
    const result = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('a3');
    expect(ids).not.toContain('a2');
  });

  it('uses the injected toCivilDate function for bucketing', () => {
    // Verify the injectable civil-date function is actually called
    const sessions = [makeSession('b1', '2026-07-05T10:00', 4)];
    const called: string[] = [];
    const spy = (ts: string): string => {
      called.push(ts);
      return ts.slice(0, 10);
    };
    getKickCountSessionsForDate(sessions, '2026-07-05', spy);
    expect(called).toContain('2026-07-05T10:00');
  });
});

// ─── Civil-date day boundary (FLAG-1: tz-stable floating-civil) ──────────────

describe('getKickCountSessionsForDate — day boundary (FLAG-1)', () => {
  it('23:30 session stays on its civil date — does NOT roll into next day', () => {
    const sessions = [makeSession('late', '2026-07-05T23:30', 3)];
    // Should be on 2026-07-05
    const onDate = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(onDate).toHaveLength(1);
    expect(onDate[0].id).toBe('late');
    // Should NOT appear on 2026-07-06
    const nextDay = getKickCountSessionsForDate(sessions, '2026-07-06', sliceToCivil);
    expect(nextDay).toHaveLength(0);
  });

  it('00:00 session stays on its civil date — does NOT roll into previous day', () => {
    const sessions = [makeSession('early', '2026-07-06T00:00', 2)];
    // Should be on 2026-07-06 only
    const onDate = getKickCountSessionsForDate(sessions, '2026-07-06', sliceToCivil);
    expect(onDate).toHaveLength(1);
    // Should NOT appear on 2026-07-05
    const prevDay = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(prevDay).toHaveLength(0);
  });
});

// ─── Sort order ───────────────────────────────────────────────────────────────

describe('getKickCountSessionsForDate — sort order', () => {
  it('sorts multiple sessions on the same day by startedAt ascending', () => {
    const sessions = [
      makeSession('c2', '2026-07-05T14:00', 5),
      makeSession('c1', '2026-07-05T09:00', 7),
      makeSession('c3', '2026-07-05T20:30', 2),
    ];
    const result = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('c1');
    expect(result[1].id).toBe('c2');
    expect(result[2].id).toBe('c3');
  });
});

// ─── View-model shape ─────────────────────────────────────────────────────────

describe('getKickCountSessionsForDate — view-model', () => {
  it('returns { id, timeLabel, movementCount } for each matching session', () => {
    const sessions = [makeSession('d1', '2026-07-05T10:30', 8)];
    const result = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'd1',
      timeLabel: '10:30',
      movementCount: 8,
    });
  });

  it('timeLabel is the HH:mm slice of startedAt (matches CalendarScreen time display pattern)', () => {
    const sessions = [makeSession('d2', '2026-07-05T07:05', 4)];
    const [item] = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(item.timeLabel).toBe('07:05');
  });

  it('movementCount=0 is valid (K-B1: count=0 completed session is legal)', () => {
    const sessions = [makeSession('d3', '2026-07-05T11:00', 0)];
    const [item] = getKickCountSessionsForDate(sessions, '2026-07-05', sliceToCivil);
    expect(item.movementCount).toBe(0);
  });
});
