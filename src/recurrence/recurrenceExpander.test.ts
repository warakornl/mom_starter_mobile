/**
 * Recurrence expander tests — FLAG-4.
 *
 * The 9 golden test-vectors (GV-1..GV-7 including GV-2b, GV-6b) are the
 * CANONICAL shared fixture from data-model.md §3.5 / api-contract.md (d).
 * Both rn-mobile-dev (JS) and springboot-backend-dev (Java) MUST pass every
 * row byte-identically.  Any divergence here means scheduledLocalCivil
 * (≡ scheduledLocalTime) strings differ → uuidv5 diverges → a legitimate
 * done/snoozed push strands in rejected[] permanently (adherence-data loss).
 *
 * Algorithm pinned in api-contract.md §"Recurrence grammar & deterministic
 * expansion (b)" + data-model.md §3.5 derivation notes.
 */
import { expand } from './recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';

// ─── Golden test-vectors (GV-1..GV-7, 9 cases) ───────────────────────────────

describe('recurrenceExpander golden vectors (FLAG-4, data-model.md §3.5)', () => {

  it('GV-1: daily fully inside window', () => {
    // freq=daily, timesOfDay=["08:00"], startAt=2026-07-01T08:00, no until
    // window [2026-07-01, 2026-07-03]
    expect(
      expand(
        { freq: 'daily', timesOfDay: ['08:00'], startAt: '2026-07-01T08:00' },
        '2026-07-01', '2026-07-03',
      ),
    ).toEqual(['2026-07-01T08:00', '2026-07-02T08:00', '2026-07-03T08:00']);
  });

  it('GV-2: every_n_days interval=3, windowStart off-cycle → k0=ceil(4/3)=2, first=07-07', () => {
    // freq=every_n_days, interval=3, timesOfDay=["09:00"], startAt=2026-07-01T09:00
    // window [2026-07-05, 2026-07-14]
    // cycle days: 07-01, 07-04, 07-07, 07-10, 07-13
    // gap = 07-05 - 07-01 = 4; k0 = ceil(4/3) = 2; first d = 07-01+6 = 07-07
    expect(
      expand(
        { freq: 'every_n_days', interval: 3, timesOfDay: ['09:00'], startAt: '2026-07-01T09:00' },
        '2026-07-05', '2026-07-14',
      ),
    ).toEqual(['2026-07-07T09:00', '2026-07-10T09:00', '2026-07-13T09:00']);
  });

  it('GV-2b: every_n_days windowStart exactly on-cycle → k0=ceil(3/3)=1, first=07-04; end on-cycle is inclusive', () => {
    // freq=every_n_days, interval=3, timesOfDay=["09:00"], startAt=2026-07-01T09:00
    // window [2026-07-04, 2026-07-10]
    // gap = 3; k0 = ceil(3/3) = 1; first d = 07-04
    expect(
      expand(
        { freq: 'every_n_days', interval: 3, timesOfDay: ['09:00'], startAt: '2026-07-01T09:00' },
        '2026-07-04', '2026-07-10',
      ),
    ).toEqual(['2026-07-04T09:00', '2026-07-07T09:00', '2026-07-10T09:00']);
  });

  it('GV-3: first-day anchor guard — times < anchor.time skipped on anchor.date; multi-timesOfDay stable ordering', () => {
    // freq=daily, timesOfDay=["08:00","14:00","20:00"], startAt=2026-07-01T14:00
    // window [2026-07-01, 2026-07-02]
    // On 07-01 (anchor date): skip 08:00 (< 14:00), emit 14:00, 20:00
    // On 07-02: emit all 08:00, 14:00, 20:00
    expect(
      expand(
        { freq: 'daily', timesOfDay: ['08:00', '14:00', '20:00'], startAt: '2026-07-01T14:00' },
        '2026-07-01', '2026-07-02',
      ),
    ).toEqual([
      '2026-07-01T14:00', '2026-07-01T20:00',
      '2026-07-02T08:00', '2026-07-02T14:00', '2026-07-02T20:00',
    ]);
  });

  it('GV-4: until is INCLUSIVE (d <= until; 07-03 emitted, window extends past until)', () => {
    // freq=daily, timesOfDay=["07:00"], startAt=2026-07-01T07:00, until=2026-07-03
    // window [2026-07-01, 2026-07-31]
    expect(
      expand(
        { freq: 'daily', timesOfDay: ['07:00'], startAt: '2026-07-01T07:00', until: '2026-07-03' },
        '2026-07-01', '2026-07-31',
      ),
    ).toEqual(['2026-07-01T07:00', '2026-07-02T07:00', '2026-07-03T07:00']);
  });

  it('GV-5: window entirely before anchor → empty (clamp guards back-fill)', () => {
    // freq=daily, timesOfDay=["08:00"], startAt=2026-07-10T08:00
    // window [2026-07-01, 2026-07-05] — ends before anchor 07-10
    // gap = max(0, 07-01 - 07-10) = max(0, -9) = 0 → k0=0, first=07-10 > end=07-05 → no loop
    expect(
      expand(
        { freq: 'daily', timesOfDay: ['08:00'], startAt: '2026-07-10T08:00' },
        '2026-07-01', '2026-07-05',
      ),
    ).toEqual([]);
  });

  it('GV-6: one_off anchor.date in window', () => {
    // freq=one_off, startAt=2026-07-15T10:30, window [2026-07-01, 2026-07-31]
    expect(
      expand(
        { freq: 'one_off', startAt: '2026-07-15T10:30' },
        '2026-07-01', '2026-07-31',
      ),
    ).toEqual(['2026-07-15T10:30']);
  });

  it('GV-6b: one_off anchor.date outside window → empty', () => {
    // freq=one_off, startAt=2026-07-15T10:30, window [2026-07-16, 2026-07-31]
    expect(
      expand(
        { freq: 'one_off', startAt: '2026-07-15T10:30' },
        '2026-07-16', '2026-07-31',
      ),
    ).toEqual([]);
  });

  it('GV-7: zero-pad format — single-digit month/day/hour/minute all 2-padded; T literal; no seconds/zone', () => {
    // freq=one_off, startAt=2026-01-05T09:05, window [2026-01-01, 2026-01-31]
    const result = expand(
      { freq: 'one_off', startAt: '2026-01-05T09:05' },
      '2026-01-01', '2026-01-31',
    );
    expect(result).toEqual(['2026-01-05T09:05']);
    // Verify exact byte format: no zone, no seconds, T literal
    expect(result[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

});

// ─── GV-8..GV-13: weekly golden vectors (recurrence-weekly-byday-design.md §2.3) ─

describe('recurrenceExpander weekly golden vectors (GV-8..GV-13)', () => {
  // Anchor date: 2026-07-01 = Wednesday (verified: isoDow0 = (epochDay+3)%7; epoch
  // day 0 = 1970-01-01 = Thursday; 2026-07-01 epoch day = 20635; (20635+3)%7 = 2 = WE)

  it('GV-8: single weekday interval 1, anchor IS that weekday', () => {
    // freq=weekly, byDay=["WE"], startAt=2026-07-01T08:00 (Wed), window [2026-07-01..2026-07-15]
    // Fires on all Wednesdays: 07-01, 07-08, 07-15
    expect(
      expand(
        { freq: 'weekly', timesOfDay: ['08:00'], byDay: ['WE'], startAt: '2026-07-01T08:00' },
        '2026-07-01', '2026-07-15',
      ),
    ).toEqual(['2026-07-01T08:00', '2026-07-08T08:00', '2026-07-15T08:00']);
  });

  it('GV-9: Mon/Wed/Fri, interval 1, anchor Wed', () => {
    // freq=weekly, byDay=["MO","WE","FR"], startAt=2026-07-01T09:00 (Wed), window [07-01..07-08]
    // MO=06-29(before window), WE=07-01✓, FR=07-03✓, MO=07-06✓, WE=07-08✓, FR=07-10(after)
    expect(
      expand(
        { freq: 'weekly', timesOfDay: ['09:00'], byDay: ['MO', 'WE', 'FR'], startAt: '2026-07-01T09:00' },
        '2026-07-01', '2026-07-08',
      ),
    ).toEqual([
      '2026-07-01T09:00', '2026-07-03T09:00',
      '2026-07-06T09:00', '2026-07-08T09:00',
    ]);
  });

  it('GV-10: every 2 weeks on Monday; anchor Wed (week 0). 07-06=week1(skip), 07-13=week2(fire), 07-27=week4(fire)', () => {
    // freq=weekly, interval=2, byDay=["MO"], startAt=2026-07-01T07:00 (Wed)
    // anchorMonday=2026-06-29 (epochDay - 2)
    // 07-06 MO: weekIndex=(07-06 - 06-29)/7=1 → 1%2≠0 skip
    // 07-13 MO: weekIndex=2 → 2%2=0 fire
    // 07-20 MO: weekIndex=3 → skip
    // 07-27 MO: weekIndex=4 → 4%2=0 fire
    expect(
      expand(
        { freq: 'weekly', interval: 2, timesOfDay: ['07:00'], byDay: ['MO'], startAt: '2026-07-01T07:00' },
        '2026-07-01', '2026-08-01',
      ),
    ).toEqual(['2026-07-13T07:00', '2026-07-27T07:00']);
  });

  it('GV-11: first-day anchor guard + multi-times; anchor Wed 14:00, byDay incl WE', () => {
    // freq=weekly, byDay=["WE"], timesOfDay=["08:00","14:00","20:00"], startAt=2026-07-01T14:00
    // 07-01 Wed: skip 08:00 (< 14:00 anchor guard), emit 14:00, 20:00
    // 07-08 Wed: emit 08:00, 14:00, 20:00
    expect(
      expand(
        {
          freq: 'weekly',
          timesOfDay: ['08:00', '14:00', '20:00'],
          byDay: ['WE'],
          startAt: '2026-07-01T14:00',
        },
        '2026-07-01', '2026-07-08',
      ),
    ).toEqual([
      '2026-07-01T14:00', '2026-07-01T20:00',
      '2026-07-08T08:00', '2026-07-08T14:00', '2026-07-08T20:00',
    ]);
  });

  it('GV-12: anchor weekday NOT in byDay → first fire on next matching weekday', () => {
    // freq=weekly, byDay=["FR"], startAt=2026-07-01T07:00 (Wed, NOT in byDay)
    // 07-03 Fri: week 0 (same ISO Monday 06-29), tokenOf=FR ✓ → fire
    // 07-10 Fri: week 1 → 1%1=0 → fire
    expect(
      expand(
        { freq: 'weekly', timesOfDay: ['07:00'], byDay: ['FR'], startAt: '2026-07-01T07:00' },
        '2026-07-01', '2026-07-10',
      ),
    ).toEqual(['2026-07-03T07:00', '2026-07-10T07:00']);
  });

  it('GV-13: inclusive until clips the last week', () => {
    // freq=weekly, byDay=["WE","FR"], startAt=2026-07-01T07:00, until=2026-07-08
    // window [2026-07-01..2026-07-31] but until=07-08 clips it
    // 07-01 WE ✓, 07-03 FR ✓, 07-08 WE ✓, 07-10 FR (past until) → stop
    expect(
      expand(
        {
          freq: 'weekly',
          timesOfDay: ['07:00'],
          byDay: ['WE', 'FR'],
          startAt: '2026-07-01T07:00',
          until: '2026-07-08',
        },
        '2026-07-01', '2026-07-31',
      ),
    ).toEqual(['2026-07-01T07:00', '2026-07-03T07:00', '2026-07-08T07:00']);
  });
});

// ─── Existing behavior tests (updated to new API: startAt instead of startDate) ──

describe('recurrenceExpander existing behavior', () => {

  it('daily inclusive of window ends', () => {
    expect(
      expand({ freq: 'daily', timesOfDay: ['08:00'], startAt: '2026-06-01T08:00' },
        '2026-06-01', '2026-06-03'),
    ).toEqual(['2026-06-01T08:00', '2026-06-02T08:00', '2026-06-03T08:00']);
  });

  it('every_n_days steps on grid', () => {
    expect(
      expand({ freq: 'every_n_days', interval: 2, timesOfDay: ['09:30'], startAt: '2026-06-01T09:30' },
        '2026-06-01', '2026-06-05'),
    ).toEqual(['2026-06-01T09:30', '2026-06-03T09:30', '2026-06-05T09:30']);
  });

  it('one_off only when in window', () => {
    const rule = { freq: 'one_off' as const, startAt: '2026-06-10T07:00' };
    expect(expand(rule, '2026-06-01', '2026-06-30')).toEqual(['2026-06-10T07:00']);
    expect(expand(rule, '2026-07-01', '2026-07-30')).toEqual([]);
  });

  it('respects inclusive until', () => {
    expect(
      expand({ freq: 'daily', timesOfDay: ['08:00'], startAt: '2026-06-01T08:00', until: '2026-06-02' },
        '2026-06-01', '2026-06-30'),
    ).toEqual(['2026-06-01T08:00', '2026-06-02T08:00']);
  });

  it('projection and materialization yield the same occurrence id', () => {
    const rule = { freq: 'daily' as const, timesOfDay: ['08:00'], startAt: '2026-06-01T08:00' };
    const projected = expand(rule, '2026-06-01', '2026-06-30');
    const materialized = expand(rule, '2026-06-15', '2026-06-15');
    const civil = '2026-06-15T08:00';

    expect(projected).toContain(civil);
    expect(materialized).toEqual([civil]);
    expect(computeOccurrenceId('rem-abc', civil)).toBe(
      computeOccurrenceId('rem-abc', materialized[0]),
    );
  });

});
