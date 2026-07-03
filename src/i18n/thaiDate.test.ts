import { formatFullDate, toBuddhistYear, formatCaptureDate } from './thaiDate';
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

// ─── formatCaptureDate (blocker #7 — human-readable date in "when" row) ───────
//
// Spec §2/§7: "when" row must show localized date, not raw ISO.
//  th → วันอาทิตย์ที่ 28 มิ.ย. 2569   (Buddhist Era, abbreviated month, day-of-week)
//  en → Sunday 28 Jun 2026            (CE, abbreviated month, day-of-week)
//
// RED: these fail until formatCaptureDate is exported from thaiDate.ts.

describe('formatCaptureDate (blocker #7 — localized human date for capture "when" row)', () => {
  // 2026-06-28 is a Sunday
  it('th: วันอาทิตย์ที่ 28 มิ.ย. 2569', () => {
    expect(formatCaptureDate('2026-06-28', 'th')).toBe('วันอาทิตย์ที่ 28 มิ.ย. 2569');
  });

  it('en: Sunday 28 Jun 2026', () => {
    expect(formatCaptureDate('2026-06-28', 'en')).toBe('Sunday 28 Jun 2026');
  });

  // 2026-07-03 is a Friday
  it('th: วันศุกร์ที่ 3 ก.ค. 2569', () => {
    expect(formatCaptureDate('2026-07-03', 'th')).toBe('วันศุกร์ที่ 3 ก.ค. 2569');
  });

  it('en: Friday 3 Jul 2026', () => {
    expect(formatCaptureDate('2026-07-03', 'en')).toBe('Friday 3 Jul 2026');
  });

  it('th: Buddhist era year = CE + 543', () => {
    const result = formatCaptureDate('2026-01-15', 'th');
    expect(result).toContain('2569');   // 2026+543
  });

  it('en: CE year shown (not BE)', () => {
    const result = formatCaptureDate('2026-01-15', 'en');
    expect(result).toContain('2026');
    expect(result).not.toContain('2569');
  });

  it('display never affects calendar bucketing', () => {
    const iso = '2026-06-28T09:15';
    expect(bucketCivilDay(iso)).toBe('2026-06-28');
    formatCaptureDate('2026-06-28', 'th');
    expect(bucketCivilDay(iso)).toBe('2026-06-28');
  });
});
