import { computeDayIndicator } from './indicatorPrecedence';

describe('per-day indicator precedence (missed > due > all-handled > logged-only > none)', () => {
  it('missed beats everything', () => {
    expect(computeDayIndicator(['missed', 'done', 'due'], true)).toBe('missed');
  });

  it('due beats all-handled and logged-only', () => {
    expect(computeDayIndicator(['due', 'done'], true)).toBe('due');
  });

  it('all done/snoozed with at least one done = allHandled (stamp)', () => {
    expect(computeDayIndicator(['done', 'snoozed'], false)).toBe('allHandled');
  });

  it('all-handled purely via snooze = crescent, never the done stamp', () => {
    expect(computeDayIndicator(['snoozed', 'snoozed'], false)).toBe('allHandledSnoozed');
  });

  it('no occurrences but logged entries = loggedOnly', () => {
    expect(computeDayIndicator([], true)).toBe('loggedOnly');
  });

  it('nothing = none', () => {
    expect(computeDayIndicator([], false)).toBe('none');
  });
});
