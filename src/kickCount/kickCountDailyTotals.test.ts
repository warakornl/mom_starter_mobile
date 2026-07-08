/**
 * kickCountDailyTotals.test.ts — TDD (RED → GREEN) for the buildDailyKickTotals helper.
 *
 * Security: test inputs NEVER appear in console logs.
 * K-8: movementCount is health data — no logging anywhere in this or the impl.
 *
 * Test matrix:
 *   1. from > to guard → empty array
 *   2. from === to → single-day range
 *   3. Multi-session same day → sums movementCount
 *   4. Multi-day range: days with no sessions fill with 0
 *   5. Sessions outside the range are excluded
 *   6. Day-boundary: session at 23:59 stays on its civil day
 *   7. Sessions with movementCount=0 count as a session (B1 — valid completed session)
 *   8. Ascending order by date (first item is fromDate, last is toDate)
 *   9. Single session spanning exactly fromDate
 *  10. movementCount totals correctly over multi-session, multi-day range
 */

import {
  buildDailyKickTotals,
  type DailyKickTotal,
} from './kickCountDailyTotals';
import type { KickCountSessionRecord } from './kickCountTypes';

// ─── Session factory ──────────────────────────────────────────────────────────

let _idSeq = 0;
function makeSession(
  startedAt: string,
  movementCount: number,
): KickCountSessionRecord {
  _idSeq += 1;
  return {
    id: `test-id-${_idSeq}`,
    startedAt,
    movementCount,
    targetCount: 10,
    status: 'completed',
    version: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

// ─── 1. from > to guard ───────────────────────────────────────────────────────

describe('buildDailyKickTotals — from > to guard', () => {
  it('returns empty array when fromDate is after toDate', () => {
    const result = buildDailyKickTotals([], '2026-07-10', '2026-07-01');
    expect(result).toEqual([]);
  });

  it('returns empty array with sessions present but inverted range', () => {
    const sessions = [makeSession('2026-07-05T10:00', 8)];
    const result = buildDailyKickTotals(sessions, '2026-07-10', '2026-07-05');
    expect(result).toEqual([]);
  });
});

// ─── 2. from === to (single day) ─────────────────────────────────────────────

describe('buildDailyKickTotals — single-day range', () => {
  it('returns exactly one entry for a same-day range', () => {
    const result = buildDailyKickTotals([], '2026-07-05', '2026-07-05');
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe('2026-07-05');
  });

  it('returns totalCount 0 and sessionCount 0 when no sessions on that day', () => {
    const result = buildDailyKickTotals([], '2026-07-05', '2026-07-05');
    expect(result[0]).toEqual({ date: '2026-07-05', totalCount: 0, sessionCount: 0 });
  });

  it('returns correct totalCount and sessionCount for one session on that day', () => {
    const sessions = [makeSession('2026-07-05T14:30', 7)];
    const result = buildDailyKickTotals(sessions, '2026-07-05', '2026-07-05');
    expect(result[0]).toEqual({ date: '2026-07-05', totalCount: 7, sessionCount: 1 });
  });
});

// ─── 3. Multi-session same day → sum ─────────────────────────────────────────

describe('buildDailyKickTotals — multi-session same day summing', () => {
  it('sums movementCount across sessions on the same civil day', () => {
    const sessions = [
      makeSession('2026-07-05T08:00', 5),
      makeSession('2026-07-05T14:00', 10),
      makeSession('2026-07-05T20:30', 3),
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-05', '2026-07-05');
    expect(result[0]!.totalCount).toBe(18);
    expect(result[0]!.sessionCount).toBe(3);
  });

  it('each session with movementCount=0 still increments sessionCount (B1)', () => {
    const sessions = [
      makeSession('2026-07-05T08:00', 0),
      makeSession('2026-07-05T14:00', 0),
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-05', '2026-07-05');
    expect(result[0]!.totalCount).toBe(0);
    expect(result[0]!.sessionCount).toBe(2);
  });
});

// ─── 4. Multi-day range: empty days fill with 0 ──────────────────────────────

describe('buildDailyKickTotals — multi-day range, empty-day fill', () => {
  it('returns one entry per civil day in the range (inclusive)', () => {
    const result = buildDailyKickTotals([], '2026-07-01', '2026-07-07');
    expect(result).toHaveLength(7);
  });

  it('each day in an empty range has totalCount 0 and sessionCount 0', () => {
    const result = buildDailyKickTotals([], '2026-07-01', '2026-07-03');
    expect(result[0]).toEqual({ date: '2026-07-01', totalCount: 0, sessionCount: 0 });
    expect(result[1]).toEqual({ date: '2026-07-02', totalCount: 0, sessionCount: 0 });
    expect(result[2]).toEqual({ date: '2026-07-03', totalCount: 0, sessionCount: 0 });
  });

  it('fills days with no sessions correctly in a sparse range', () => {
    const sessions = [
      makeSession('2026-07-01T10:00', 8),
      makeSession('2026-07-03T18:00', 10),
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-03');
    expect(result[0]).toEqual({ date: '2026-07-01', totalCount: 8, sessionCount: 1 });
    expect(result[1]).toEqual({ date: '2026-07-02', totalCount: 0, sessionCount: 0 });
    expect(result[2]).toEqual({ date: '2026-07-03', totalCount: 10, sessionCount: 1 });
  });
});

// ─── 5. Sessions outside the range are excluded ───────────────────────────────

describe('buildDailyKickTotals — sessions outside range excluded', () => {
  it('excludes sessions before fromDate', () => {
    const sessions = [
      makeSession('2026-06-30T23:59', 9),  // day before range
      makeSession('2026-07-01T08:00', 6),  // first day of range
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-01');
    expect(result[0]!.totalCount).toBe(6);
    expect(result[0]!.sessionCount).toBe(1);
  });

  it('excludes sessions after toDate', () => {
    const sessions = [
      makeSession('2026-07-07T09:00', 8),  // in range
      makeSession('2026-07-08T00:01', 10), // day after range
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-07', '2026-07-07');
    expect(result[0]!.totalCount).toBe(8);
    expect(result[0]!.sessionCount).toBe(1);
  });

  it('sessions far outside range do not appear in results', () => {
    const sessions = [
      makeSession('2026-01-01T10:00', 10),
      makeSession('2026-12-31T10:00', 10),
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-03');
    result.forEach((day) => {
      expect(day.totalCount).toBe(0);
      expect(day.sessionCount).toBe(0);
    });
  });
});

// ─── 6. Day-boundary: 23:xx stays on its civil day ───────────────────────────

describe('buildDailyKickTotals — civil day boundary (FLAG-1)', () => {
  it('session at 23:59 stays on its civil date, not the next day', () => {
    const sessions = [makeSession('2026-07-01T23:59', 5)];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-02');
    expect(result[0]!.date).toBe('2026-07-01');
    expect(result[0]!.totalCount).toBe(5);
    expect(result[1]!.date).toBe('2026-07-02');
    expect(result[1]!.totalCount).toBe(0);
  });

  it('session at 00:00 is on that civil day', () => {
    const sessions = [makeSession('2026-07-02T00:00', 8)];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-02');
    expect(result[0]!.totalCount).toBe(0);
    expect(result[1]!.totalCount).toBe(8);
  });
});

// ─── 7. Sessions with movementCount = 0 are valid (B1) ───────────────────────

describe('buildDailyKickTotals — movementCount=0 sessions are valid (B1)', () => {
  it('counts a session with movementCount=0 in sessionCount', () => {
    const sessions = [makeSession('2026-07-05T12:00', 0)];
    const result = buildDailyKickTotals(sessions, '2026-07-05', '2026-07-05');
    expect(result[0]!.sessionCount).toBe(1);
    expect(result[0]!.totalCount).toBe(0);
  });
});

// ─── 8. Ascending order ───────────────────────────────────────────────────────

describe('buildDailyKickTotals — ascending date order', () => {
  it('returns entries in ascending date order (fromDate first)', () => {
    const result = buildDailyKickTotals([], '2026-07-01', '2026-07-05');
    const dates = result.map((r) => r.date);
    expect(dates).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
  });

  it('returns entries sorted ascending even when sessions are in random order', () => {
    const sessions = [
      makeSession('2026-07-03T10:00', 5),
      makeSession('2026-07-01T09:00', 8),
      makeSession('2026-07-05T14:00', 3),
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-05');
    const dates = result.map((r) => r.date);
    expect(dates).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
  });
});

// ─── 9. Month boundary (end-of-month, no overflow) ───────────────────────────

describe('buildDailyKickTotals — month boundary', () => {
  it('correctly handles a range spanning a month boundary', () => {
    const sessions = [
      makeSession('2026-06-30T20:00', 7),
      makeSession('2026-07-01T08:00', 9),
    ];
    const result = buildDailyKickTotals(sessions, '2026-06-30', '2026-07-01');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: '2026-06-30', totalCount: 7, sessionCount: 1 });
    expect(result[1]).toEqual({ date: '2026-07-01', totalCount: 9, sessionCount: 1 });
  });

  it('correctly handles February / leap-year month boundary', () => {
    const sessions = [makeSession('2028-02-29T10:00', 6)];
    const result = buildDailyKickTotals(sessions, '2028-02-29', '2028-03-01');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: '2028-02-29', totalCount: 6, sessionCount: 1 });
    expect(result[1]).toEqual({ date: '2028-03-01', totalCount: 0, sessionCount: 0 });
  });
});

// ─── 10. Multi-session, multi-day totals ─────────────────────────────────────

describe('buildDailyKickTotals — multi-session multi-day totals', () => {
  it('correctly assigns sessions to their respective civil days', () => {
    const sessions = [
      makeSession('2026-07-01T08:00', 10),
      makeSession('2026-07-01T16:00', 8),
      makeSession('2026-07-02T09:00', 5),
      makeSession('2026-07-03T11:00', 3),
      makeSession('2026-07-03T20:00', 7),
    ];
    const result = buildDailyKickTotals(sessions, '2026-07-01', '2026-07-03');
    expect(result[0]).toEqual({ date: '2026-07-01', totalCount: 18, sessionCount: 2 });
    expect(result[1]).toEqual({ date: '2026-07-02', totalCount: 5, sessionCount: 1 });
    expect(result[2]).toEqual({ date: '2026-07-03', totalCount: 10, sessionCount: 2 });
  });
});

// ─── 11. Return type shape ────────────────────────────────────────────────────

describe('buildDailyKickTotals — return type shape', () => {
  it('each result entry has date, totalCount, sessionCount', () => {
    const result = buildDailyKickTotals([], '2026-07-01', '2026-07-01');
    const entry = result[0] as DailyKickTotal;
    expect(typeof entry.date).toBe('string');
    expect(typeof entry.totalCount).toBe('number');
    expect(typeof entry.sessionCount).toBe('number');
  });

  it('date field is in YYYY-MM-DD format', () => {
    const result = buildDailyKickTotals([], '2026-07-01', '2026-07-03');
    for (const entry of result) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
