import { expand } from './recurrenceExpander';
import { computeOccurrenceId } from '../occurrence/occurrenceId';

describe('recurrence expansion', () => {
  it('daily, inclusive of window', () => {
    expect(
      expand({ freq: 'daily', timesOfDay: ['08:00'], startDate: '2026-06-01' },
        '2026-06-01', '2026-06-03'),
    ).toEqual(['2026-06-01T08:00', '2026-06-02T08:00', '2026-06-03T08:00']);
  });

  it('every_n_days steps on grid', () => {
    expect(
      expand({ freq: 'every_n_days', interval: 2, timesOfDay: ['09:30'], startDate: '2026-06-01' },
        '2026-06-01', '2026-06-05'),
    ).toEqual(['2026-06-01T09:30', '2026-06-03T09:30', '2026-06-05T09:30']);
  });

  it('one_off only when in window', () => {
    const rule = { freq: 'one_off' as const, timesOfDay: ['07:00'], startDate: '2026-06-10' };
    expect(expand(rule, '2026-06-01', '2026-06-30')).toEqual(['2026-06-10T07:00']);
    expect(expand(rule, '2026-07-01', '2026-07-30')).toEqual([]);
  });

  it('respects inclusive until', () => {
    expect(
      expand({ freq: 'daily', timesOfDay: ['08:00'], startDate: '2026-06-01', until: '2026-06-02' },
        '2026-06-01', '2026-06-30'),
    ).toEqual(['2026-06-01T08:00', '2026-06-02T08:00']);
  });

  it('projection and materialization yield the same occurrence id', () => {
    const rule = { freq: 'daily' as const, timesOfDay: ['08:00'], startDate: '2026-06-01' };
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
