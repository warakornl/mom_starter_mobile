/**
 * babySizeData.test.ts — TDD tests for the baby-size comparison data table.
 *
 * Tests: week→entry mapping, fallback rules, null/unknown handling, weight omit for wks 5–7.
 * All tests are pure-node (no React Native) — data layer only.
 */

import {
  BABY_SIZE_DATA,
  getBabySizeEntry,
  formatWeightDisplay,
  type BabySizeEntry,
  type BabySizeIconKey,
} from './babySizeData';

// ─── Data table completeness ──────────────────────────────────────────────────

describe('BABY_SIZE_DATA', () => {
  it('covers exactly weeks 5 through 40 (36 entries)', () => {
    expect(BABY_SIZE_DATA).toHaveLength(36);
    const weeks = BABY_SIZE_DATA.map((e) => e.week);
    expect(weeks[0]).toBe(5);
    expect(weeks[weeks.length - 1]).toBe(40);
  });

  it('has no gaps in weeks 5–40', () => {
    for (let w = 5; w <= 40; w++) {
      const entry = BABY_SIZE_DATA.find((e) => e.week === w);
      expect(entry).toBeDefined();
    }
  });

  it('weeks 5–7 have weightG=null (weight omitted per legal S2)', () => {
    for (const wk of [5, 6, 7]) {
      const entry = BABY_SIZE_DATA.find((e) => e.week === wk)!;
      expect(entry.weightG).toBeNull();
      expect(entry.weightIsKg).toBe(false);
    }
  });

  it('week 8+ have weightG non-null', () => {
    for (let w = 8; w <= 40; w++) {
      const entry = BABY_SIZE_DATA.find((e) => e.week === w)!;
      expect(entry.weightG).not.toBeNull();
    }
  });

  it('weightIsKg=true only for entries with weightG>=1000', () => {
    for (const entry of BABY_SIZE_DATA) {
      if (entry.weightG !== null) {
        if (entry.weightIsKg) {
          expect(entry.weightG).toBeGreaterThanOrEqual(1000);
        } else {
          expect(entry.weightG).toBeLessThan(1000);
        }
      }
    }
  });

  it('all entries have non-empty nameTh and nameEn', () => {
    for (const entry of BABY_SIZE_DATA) {
      expect(entry.nameTh.length).toBeGreaterThan(0);
      expect(entry.nameEn.length).toBeGreaterThan(0);
    }
  });

  it('all entries have a valid iconKey', () => {
    const validKeys: BabySizeIconKey[] = [
      'small-round', 'large-ribbed-round', 'strawberry', 'apple',
      'avocado', 'pear', 'mango', 'banana', 'carrot', 'papaya',
      'corn', 'pineapple', 'eggplant', 'squash', 'watermelon',
    ];
    for (const entry of BABY_SIZE_DATA) {
      expect(validKeys).toContain(entry.iconKey);
    }
  });

  it('weeks 5–9 and 11–13 use small-round icon (round-fruit family)', () => {
    const smallRoundWeeks = [5, 6, 7, 8, 9, 11, 12, 13];
    for (const wk of smallRoundWeeks) {
      const entry = BABY_SIZE_DATA.find((e) => e.week === wk)!;
      expect(entry.iconKey).toBe('small-round');
    }
  });

  it('wk 10 (strawberry) uses strawberry icon', () => {
    const entry = BABY_SIZE_DATA.find((e) => e.week === 10)!;
    expect(entry.iconKey).toBe('strawberry');
  });

  it('wk 20 (banana) uses banana icon', () => {
    const entry = BABY_SIZE_DATA.find((e) => e.week === 20)!;
    expect(entry.iconKey).toBe('banana');
    expect(entry.nameTh).toBe('กล้วยหอม');
  });

  it('wk 40 uses large-ribbed-round icon (pumpkin)', () => {
    const entry = BABY_SIZE_DATA.find((e) => e.week === 40)!;
    expect(entry.iconKey).toBe('large-ribbed-round');
    expect(entry.nameTh).toBe('ฟักทอง');
  });
});

// ─── getBabySizeEntry lookup + fallback rules ──────────────────────────────────

describe('getBabySizeEntry', () => {
  it('returns null for week < 5', () => {
    expect(getBabySizeEntry(4)).toBeNull();
    expect(getBabySizeEntry(1)).toBeNull();
    expect(getBabySizeEntry(0)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getBabySizeEntry(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getBabySizeEntry(undefined)).toBeNull();
  });

  it('returns wk-5 entry for week=5', () => {
    const entry = getBabySizeEntry(5);
    expect(entry).not.toBeNull();
    expect(entry!.week).toBe(5);
  });

  it('returns correct entry for week=20 (banana week)', () => {
    const entry = getBabySizeEntry(20);
    expect(entry).not.toBeNull();
    expect(entry!.nameTh).toBe('กล้วยหอม');
    expect(entry!.iconKey).toBe('banana');
  });

  it('returns wk-40 entry for week=40', () => {
    const entry = getBabySizeEntry(40);
    expect(entry!.week).toBe(40);
  });

  it('returns wk-40 entry for week>40 (overdue fallback)', () => {
    const entry41 = getBabySizeEntry(41);
    const entry50 = getBabySizeEntry(50);
    const wk40 = BABY_SIZE_DATA.find((e) => e.week === 40)!;
    expect(entry41).toEqual(wk40);
    expect(entry50).toEqual(wk40);
  });

  it('section hidden for week=4 (boundary below min)', () => {
    // Legal S3: weeks < 5 → section hidden (return null)
    expect(getBabySizeEntry(4)).toBeNull();
  });
});

// ─── formatWeightDisplay ──────────────────────────────────────────────────────

describe('formatWeightDisplay', () => {
  it('formats grams in Thai (< 1 kg)', () => {
    expect(formatWeightDisplay(300, false, 'th')).toBe('300 ก.');
    expect(formatWeightDisplay(875, false, 'th')).toBe('875 ก.');
    expect(formatWeightDisplay(1, false, 'th')).toBe('1 ก.');
  });

  it('formats grams in English (< 1 kg)', () => {
    expect(formatWeightDisplay(300, false, 'en')).toBe('300 g');
    expect(formatWeightDisplay(875, false, 'en')).toBe('875 g');
  });

  it('formats kg in Thai (≥ 1 kg, exact)', () => {
    expect(formatWeightDisplay(1000, true, 'th')).toBe('1 กก.');
  });

  it('formats kg in Thai (≥ 1 kg, decimal)', () => {
    expect(formatWeightDisplay(1200, true, 'th')).toBe('1.2 กก.');
    expect(formatWeightDisplay(2100, true, 'th')).toBe('2.1 กก.');
    expect(formatWeightDisplay(3400, true, 'th')).toBe('3.4 กก.');
  });

  it('formats kg in English (≥ 1 kg, exact)', () => {
    expect(formatWeightDisplay(1000, true, 'en')).toBe('1 kg');
  });

  it('formats kg in English (≥ 1 kg, decimal)', () => {
    expect(formatWeightDisplay(1200, true, 'en')).toBe('1.2 kg');
    expect(formatWeightDisplay(2100, true, 'en')).toBe('2.1 kg');
  });

  it('no trailing zero for exact kg', () => {
    const result = formatWeightDisplay(1000, true, 'th');
    expect(result).not.toContain('.0');
  });
});
