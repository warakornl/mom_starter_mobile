/**
 * monthYearFormatter.test.ts
 *
 * TDD tests for formatYearMonth — the pure display helper used by the
 * DoctorPdfScreen month picker to show selected months in Thai (BE era)
 * and English format.
 *
 * Reuses MONTHS arrays from messages.ts — single source of truth so
 * formatted strings match the rest of the app's date display.
 */

import { formatYearMonth } from './monthYearFormatter';

describe('formatYearMonth', () => {
  it('th: April 2026 → "เมษายน พ.ศ. 2569" (Buddhist Era +543)', () => {
    expect(formatYearMonth('2026-04', 'th')).toBe('เมษายน พ.ศ. 2569');
  });

  it('en: April 2026 → "April 2026"', () => {
    expect(formatYearMonth('2026-04', 'en')).toBe('April 2026');
  });

  it('th: January 2026 → "มกราคม พ.ศ. 2569"', () => {
    expect(formatYearMonth('2026-01', 'th')).toBe('มกราคม พ.ศ. 2569');
  });

  it('th: December 2025 → "ธันวาคม พ.ศ. 2568"', () => {
    expect(formatYearMonth('2025-12', 'th')).toBe('ธันวาคม พ.ศ. 2568');
  });

  it('en: December 2025 → "December 2025"', () => {
    expect(formatYearMonth('2025-12', 'en')).toBe('December 2025');
  });

  it('th: July 2026 → "กรกฎาคม พ.ศ. 2569"', () => {
    expect(formatYearMonth('2026-07', 'th')).toBe('กรกฎาคม พ.ศ. 2569');
  });

  it('all 12 th months have correct BE year for 2026', () => {
    const expected = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
      'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
      'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
    ];
    for (let m = 1; m <= 12; m++) {
      const mm = m < 10 ? `0${m}` : `${m}`;
      expect(formatYearMonth(`2026-${mm}`, 'th')).toBe(`${expected[m - 1]} พ.ศ. 2569`);
    }
  });

  it('all 12 en months for 2026', () => {
    const expected = [
      'January', 'February', 'March', 'April',
      'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December',
    ];
    for (let m = 1; m <= 12; m++) {
      const mm = m < 10 ? `0${m}` : `${m}`;
      expect(formatYearMonth(`2026-${mm}`, 'en')).toBe(`${expected[m - 1]} 2026`);
    }
  });
});
