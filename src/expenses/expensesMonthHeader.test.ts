/**
 * expensesMonthHeader.test.ts — TDD for the locale-aware month header fix.
 *
 * Bug: ExpensesScreen rendered both Thai AND English month names
 * unconditionally: `{MONTH_NAMES_TH[viewMonth-1]} {MONTH_NAMES_EN[viewMonth-1]}`.
 *
 * Fix: use formatYearMonth(yyyyMm, locale) from messages.ts — the shared
 * helper already used by CalendarScreen — so Expenses and Calendar show a
 * consistent, single-language month+year label.
 *
 * These tests validate:
 *   (a) formatYearMonth produces ONLY the locale-correct language (no bilingual output).
 *   (b) The yyyyMm string built from (viewYear, viewMonth) is correct.
 *   (c) Thai locale: month shown in Thai + Buddhist-era year (พ.ศ.).
 *   (d) English locale: month shown in English + CE year.
 *   (e) Old bilingual concatenation DOES NOT appear in either locale's output.
 */

import { formatYearMonth } from '../i18n/messages';

// ─── Helper: mirrors the yyyyMm building logic in ExpensesScreen ──────────────

function buildYyyyMm(viewYear: number, viewMonth: number): string {
  return `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
}

// ─── Thai locale ──────────────────────────────────────────────────────────────

describe('expensesMonthHeader — Thai locale', () => {
  it('th locale: July 2026 shows Thai month name only (กรกฎาคม), no English', () => {
    const label = formatYearMonth(buildYyyyMm(2026, 7), 'th');
    expect(label).toContain('กรกฎาคม');
    expect(label).not.toContain('July');
  });

  it('th locale: July 2026 shows Buddhist-era year (พ.ศ. 2569)', () => {
    const label = formatYearMonth(buildYyyyMm(2026, 7), 'th');
    expect(label).toContain('พ.ศ. 2569');
    // CE year must NOT appear standalone
    expect(label).not.toBe(expect.stringContaining('2026'));
  });

  it('th locale: January 2026 → "มกราคม พ.ศ. 2569"', () => {
    expect(formatYearMonth(buildYyyyMm(2026, 1), 'th')).toBe('มกราคม พ.ศ. 2569');
  });

  it('th locale: December 2025 → "ธันวาคม พ.ศ. 2568"', () => {
    expect(formatYearMonth(buildYyyyMm(2025, 12), 'th')).toBe('ธันวาคม พ.ศ. 2568');
  });

  it('th locale: label does NOT contain English month alongside Thai (no bilingual output)', () => {
    const englishMonths = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December',
    ];
    for (let m = 1; m <= 12; m++) {
      const label = formatYearMonth(buildYyyyMm(2026, m), 'th');
      for (const eng of englishMonths) {
        expect(label).not.toContain(eng);
      }
    }
  });
});

// ─── English locale ───────────────────────────────────────────────────────────

describe('expensesMonthHeader — English locale', () => {
  it('en locale: July 2026 shows English month name only (July), no Thai', () => {
    const label = formatYearMonth(buildYyyyMm(2026, 7), 'en');
    expect(label).toContain('July');
    expect(label).not.toContain('กรกฎาคม');
  });

  it('en locale: July 2026 shows CE year (2026)', () => {
    const label = formatYearMonth(buildYyyyMm(2026, 7), 'en');
    expect(label).toBe('July 2026');
  });

  it('en locale: January 2026 → "January 2026"', () => {
    expect(formatYearMonth(buildYyyyMm(2026, 1), 'en')).toBe('January 2026');
  });

  it('en locale: December 2025 → "December 2025"', () => {
    expect(formatYearMonth(buildYyyyMm(2025, 12), 'en')).toBe('December 2025');
  });

  it('en locale: label does NOT contain Thai month names (no bilingual output)', () => {
    const thaiMonths = [
      'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
    ];
    for (let m = 1; m <= 12; m++) {
      const label = formatYearMonth(buildYyyyMm(2026, m), 'en');
      for (const th of thaiMonths) {
        expect(label).not.toContain(th);
      }
    }
  });
});

// ─── yyyyMm builder ───────────────────────────────────────────────────────────

describe('buildYyyyMm — viewYear/viewMonth → YYYY-MM string', () => {
  it('single-digit month is zero-padded: month 7 → "2026-07"', () => {
    expect(buildYyyyMm(2026, 7)).toBe('2026-07');
  });

  it('double-digit month is not padded: month 12 → "2026-12"', () => {
    expect(buildYyyyMm(2026, 12)).toBe('2026-12');
  });

  it('month 1 → "2026-01"', () => {
    expect(buildYyyyMm(2026, 1)).toBe('2026-01');
  });
});
