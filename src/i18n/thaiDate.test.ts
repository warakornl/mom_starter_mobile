import { formatFullDate, toBuddhistYear } from './thaiDate';
import { bucketCivilDay } from '../calendar/civilDayBucketer';

describe('Thai/CE date formatting (display-only)', () => {
  it('Buddhist Era = CE + 543', () => {
    expect(toBuddhistYear(2026)).toBe(2569);
  });

  it('th uses BE year + Thai month name', () => {
    expect(formatFullDate('2026-06-28', 'th')).toBe('วันที่ 28 มิถุนายน พ.ศ. 2569');
  });

  it('en uses CE', () => {
    expect(formatFullDate('2026-06-28', 'en')).toBe('June 28, 2026');
  });

  it('BE display never affects the calendar bucket', () => {
    // formatting is cosmetic; bucketing still keys off the raw civil date
    const iso = '2026-06-28T23:30';
    expect(bucketCivilDay(iso)).toBe('2026-06-28');
    formatFullDate(iso.slice(0, 10), 'th'); // no side effect on bucketing
    expect(bucketCivilDay(iso)).toBe('2026-06-28');
  });
});
