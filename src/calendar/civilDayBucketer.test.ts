import { bucketCivilDay } from './civilDayBucketer';

describe('floating-civil day bucketing', () => {
  it('buckets to the civil date part', () => {
    expect(bucketCivilDay('2026-06-28T23:30')).toBe('2026-06-28');
  });

  it('a late-night feed never rolls into the next day (tz-stable)', () => {
    // No device time zone is ever applied — the civil value alone decides the day.
    expect(bucketCivilDay('2026-06-28T23:30')).toBe('2026-06-28');
    expect(bucketCivilDay('2026-06-28T00:00')).toBe('2026-06-28');
  });
});
