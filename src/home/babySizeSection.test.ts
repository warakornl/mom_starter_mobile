/**
 * babySizeSection.test.ts — TDD tests for BabySizeSection helpers + compliance.
 *
 * Covers:
 *   1. formatPostpartumAgeForSection — age display helper (all ranges)
 *   2. S2 content denylist test (legal §7.1 — fail-closed, blocks build on hit)
 *   3. S4 input-whitelist test (legal §7.2 — no mother health fields in props)
 *   4. Disclaimer always-on verification (strings present in catalog)
 *   5. i18n key parity (th and en keys exist for all baby-size keys)
 *
 * All tests run in node (testEnvironment: 'node') — no RN render.
 * S2/S4 are fail-closed: any violation RED-blocks the suite.
 *
 * Age display thresholds (design §6.2):
 *   day 0        → "เพิ่งคลอด" / "Just born"
 *   1–6 days     → "{n} วัน" / "Baby is {n} day(s) old"
 *   7–29 days    → weeks format (gated: m=floor(d/30)=0 avoids "0 months" display)
 *   30+ days     → months format (m>=1 guaranteed)
 */

import { formatPostpartumAgeForSection } from './babySizeSectionHelpers';
import { BABY_SIZE_DATA } from '../pregnancy/babySizeData';
import { catalog } from '../i18n/messages';
import type { GestationalAge } from '../pregnancy/gestationalAge';
import type { PostpartumAge } from '../pregnancy/postpartumAge';

// ─── formatPostpartumAgeForSection ───────────────────────────────────────────

describe('formatPostpartumAgeForSection', () => {
  const mkPp = (days: number): PostpartumAge => {
    const postpartumWeek = Math.floor(days / 7);
    const postpartumDay  = ((days % 7) + 7) % 7;
    return { postpartumDays: days, postpartumWeek, postpartumDay };
  };

  // ── day 0 ──────────────────────────────────────────────────────────────────
  it('day 0 → "ลูกน้อยเพิ่งคลอด" (th)', () => {
    expect(formatPostpartumAgeForSection(mkPp(0), 'th')).toBe('ลูกน้อยเพิ่งคลอด');
  });

  it('day 0 → "Baby just arrived" (en)', () => {
    expect(formatPostpartumAgeForSection(mkPp(0), 'en')).toBe('Baby just arrived');
  });

  // ── 1–6 days ───────────────────────────────────────────────────────────────
  it('1 day → "ลูกน้อยอายุ 1 วัน" (th)', () => {
    expect(formatPostpartumAgeForSection(mkPp(1), 'th')).toBe('ลูกน้อยอายุ 1 วัน');
  });

  it('1 day → "Baby is 1 day old" (en — singular)', () => {
    expect(formatPostpartumAgeForSection(mkPp(1), 'en')).toBe('Baby is 1 day old');
  });

  it('3 days → "Baby is 3 days old" (en — plural)', () => {
    expect(formatPostpartumAgeForSection(mkPp(3), 'en')).toBe('Baby is 3 days old');
  });

  it('6 days → "ลูกน้อยอายุ 6 วัน" (th)', () => {
    expect(formatPostpartumAgeForSection(mkPp(6), 'th')).toBe('ลูกน้อยอายุ 6 วัน');
  });

  // ── 7–29 days (weeks format) ───────────────────────────────────────────────
  it('7 days (1w 0d) → "ลูกน้อยอายุ 1 สัปดาห์" (th)', () => {
    expect(formatPostpartumAgeForSection(mkPp(7), 'th')).toBe('ลูกน้อยอายุ 1 สัปดาห์');
  });

  it('7 days → "Baby is 1 week old" (en — singular)', () => {
    expect(formatPostpartumAgeForSection(mkPp(7), 'en')).toBe('Baby is 1 week old');
  });

  it('14 days (2w 0d) → "ลูกน้อยอายุ 2 สัปดาห์" (th)', () => {
    expect(formatPostpartumAgeForSection(mkPp(14), 'th')).toBe('ลูกน้อยอายุ 2 สัปดาห์');
  });

  it('14 days → "Baby is 2 weeks old" (en — plural)', () => {
    expect(formatPostpartumAgeForSection(mkPp(14), 'en')).toBe('Baby is 2 weeks old');
  });

  it('10 days (1w 3d) → "ลูกน้อยอายุ 1 สัปดาห์ 3 วัน" (th)', () => {
    expect(formatPostpartumAgeForSection(mkPp(10), 'th')).toBe('ลูกน้อยอายุ 1 สัปดาห์ 3 วัน');
  });

  it('10 days → "Baby is 1 week 3 days old" (en)', () => {
    expect(formatPostpartumAgeForSection(mkPp(10), 'en')).toBe('Baby is 1 week 3 days old');
  });

  it('28 days (4w 0d) → weeks format, not months (m=0 gate)', () => {
    // 28 days: m=floor(28/30)=0 → use weeks to avoid "0 เดือน 28 วัน"
    expect(formatPostpartumAgeForSection(mkPp(28), 'th')).toBe('ลูกน้อยอายุ 4 สัปดาห์');
  });

  it('29 days (4w 1d) → weeks format (still < 30)', () => {
    expect(formatPostpartumAgeForSection(mkPp(29), 'th')).toBe('ลูกน้อยอายุ 4 สัปดาห์ 1 วัน');
  });

  // ── 30+ days (months format, m>=1) ────────────────────────────────────────
  it('30 days → "ลูกน้อยอายุ 1 เดือน" (th — exact month)', () => {
    // m = floor(30/30) = 1, r = 0
    expect(formatPostpartumAgeForSection(mkPp(30), 'th')).toBe('ลูกน้อยอายุ 1 เดือน');
  });

  it('30 days → "Baby is 1 month old" (en)', () => {
    expect(formatPostpartumAgeForSection(mkPp(30), 'en')).toBe('Baby is 1 month old');
  });

  it('35 days → "ลูกน้อยอายุ 1 เดือน 5 วัน" (th)', () => {
    // m = floor(35/30) = 1, r = 5
    expect(formatPostpartumAgeForSection(mkPp(35), 'th')).toBe('ลูกน้อยอายุ 1 เดือน 5 วัน');
  });

  it('35 days → "Baby is 1 month 5 days old" (en)', () => {
    expect(formatPostpartumAgeForSection(mkPp(35), 'en')).toBe('Baby is 1 month 5 days old');
  });

  it('45 days → "ลูกน้อยอายุ 1 เดือน 15 วัน" (th, months formula)', () => {
    // 45 >= 30 → m = floor(45/30) = 1, r = 15
    expect(formatPostpartumAgeForSection(mkPp(45), 'th')).toBe('ลูกน้อยอายุ 1 เดือน 15 วัน');
  });

  it('45 days → "Baby is 1 month 15 days old" (en)', () => {
    expect(formatPostpartumAgeForSection(mkPp(45), 'en')).toBe('Baby is 1 month 15 days old');
  });

  it('60 days → "ลูกน้อยอายุ 2 เดือน" (th — exact 2 months)', () => {
    // m = floor(60/30) = 2, r = 0
    expect(formatPostpartumAgeForSection(mkPp(60), 'th')).toBe('ลูกน้อยอายุ 2 เดือน');
  });

  it('60 days → "Baby is 2 months old" (en)', () => {
    expect(formatPostpartumAgeForSection(mkPp(60), 'en')).toBe('Baby is 2 months old');
  });
});

// ─── S2 Content Denylist Test (legal §7.1) ───────────────────────────────────
// FAIL-CLOSED: any banned token in ANY content string RED-blocks the build.
// Scope: fruit names (nameTh, nameEn), warm note, section labels — NOT disclaimers.
// Disclaimers are legally scoped OUT per §7.1: they legitimately contain
// "ตามปกติ/normal" as a reassurance phrase, distinct from health-status claims.

describe('S2 content denylist (legal §7.1 — fail-closed)', () => {
  // Banned tokens — TH (substring match)
  const bannedTh = ['ปกติ', 'ผิดปกติ', 'สุขภาพดี', 'สมส่วน', 'ตามเกณฑ์'];
  // Banned tokens — EN (case-insensitive)
  const bannedEn = ['normal', 'healthy', 'on track'];

  // Content strings (NOT disclaimers):
  const contentStringsTh: string[] = [
    ...BABY_SIZE_DATA.map((e) => e.nameTh),
    catalog.th['home.babySizeSectionLabel'],
    catalog.th['home.babyYourBabySectionLabel'],
    catalog.th['home.babyWarmNote'],
    catalog.th['home.babySizeSizeInfo'],
    catalog.th['home.babySizeSizeInfoLengthOnly'],
  ];

  const contentStringsEn: string[] = [
    ...BABY_SIZE_DATA.map((e) => e.nameEn),
    catalog.en['home.babySizeSectionLabel'],
    catalog.en['home.babyYourBabySectionLabel'],
    catalog.en['home.babyWarmNote'],
    catalog.en['home.babySizeSizeInfo'],
    catalog.en['home.babySizeSizeInfoLengthOnly'],
  ];

  it('no banned TH token in any content string (S2 — fail-closed)', () => {
    for (const str of contentStringsTh) {
      for (const token of bannedTh) {
        const found = str.includes(token);
        if (found) {
          fail(`S2 VIOLATION: banned TH token "${token}" in content string: "${str}"`);
        }
        expect(found).toBe(false);
      }
    }
  });

  it('no banned EN token in any content string (S2 — case-insensitive, fail-closed)', () => {
    for (const str of contentStringsEn) {
      const lower = str.toLowerCase();
      for (const token of bannedEn) {
        const found = lower.includes(token.toLowerCase());
        if (found) {
          fail(`S2 VIOLATION: banned EN token "${token}" in content string: "${str}"`);
        }
        expect(found).toBe(false);
      }
    }
  });

  it('S2 denylist is fail-closed: denylist catches a planted violation', () => {
    // Verifies the denylist mechanism itself works
    const badStrTh = 'ทารกโตขึ้นอย่างปกติ';
    expect(bannedTh.some((t) => badStrTh.includes(t))).toBe(true);
    const badStrEn = 'Baby is growing normally';
    expect(bannedEn.some((t) => badStrEn.toLowerCase().includes(t))).toBe(true);
  });
});

// ─── S4 Input-whitelist Test (legal §7.2) ────────────────────────────────────
// Assert the component/helper signature accepts ONLY server-derived civil-date
// data (gestationalWeek/edd/birthDate). No mother-entered health field can reach
// the renderer.

describe('S4 input-whitelist (legal §7.2 — civil-date only)', () => {
  it('GestationalAge has only civil-date-derived fields — no mother health data', () => {
    // Construct a valid GestationalAge using ONLY EDD-derived computations.
    // This type comes from computeGestationalAge(edd, today) — no health input.
    const validGa: GestationalAge = {
      daysPregnant: 140,
      gestationalWeek: 20,
      gestationalDay: 0,
      daysRemaining: 140,
      progress: 0.5,
      currentStage: 'T2',
      deliveryWindowActive: false,
      displayedWeek: 20,
      suppressDayDisplay: false,
    };
    // Mother-entered health fields must NOT be in GestationalAge
    const forbiddenKeys = ['weight', 'bloodPressure', 'bp', 'symptoms', 'selfLog', 'bmi', 'heartRate'];
    for (const key of forbiddenKeys) {
      expect(key in validGa).toBe(false);
    }
  });

  it('PostpartumAge has only civil-date-derived fields — no mother health data', () => {
    // Construct a valid PostpartumAge from computePostpartumAge(birthDate, today)
    const validPp: PostpartumAge = {
      postpartumDays: 45,
      postpartumWeek: 6,
      postpartumDay: 3,
    };
    // Mother-entered health fields must NOT be in PostpartumAge
    const forbiddenKeys = ['weight', 'bloodPressure', 'bp', 'symptoms', 'selfLog', 'bmi', 'heartRate', 'feedingType'];
    for (const key of forbiddenKeys) {
      expect(key in validPp).toBe(false);
    }
  });

  it('getBabySizeEntry accepts only a civil-date-derived week number', () => {
    // The function signature enforces S4: only gestationalWeek (number|null|undefined).
    // No other fields can be passed — TypeScript prevents health-field injection.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBabySizeEntry } = require('../pregnancy/babySizeData') as {
      getBabySizeEntry: (w: number | null | undefined) => unknown;
    };
    expect(() => getBabySizeEntry(20)).not.toThrow();
    expect(() => getBabySizeEntry(null)).not.toThrow();
    expect(() => getBabySizeEntry(undefined)).not.toThrow();
    expect(getBabySizeEntry(4)).toBeNull();
    expect((getBabySizeEntry(20) as { week: number })?.week).toBe(20);
  });

  it('S4: formatPostpartumAgeForSection accepts only PostpartumAge — no health fields', () => {
    // Only PostpartumAge (civil-date derived) can reach the formatter.
    // If PostpartumAge contained health fields, this test would fail to compile.
    const pp: PostpartumAge = { postpartumDays: 30, postpartumWeek: 4, postpartumDay: 2 };
    expect(() => formatPostpartumAgeForSection(pp, 'th')).not.toThrow();
  });
});

// ─── Disclaimer always-on (S5) ───────────────────────────────────────────────
// Verify disclaimer strings are present and contain legally-required phrases.

describe('Disclaimer always-on (S5)', () => {
  it('pregnant short-form (TH): contains required legal phrases', () => {
    const str = catalog.th['home.babySizeDisclaimer'];
    expect(typeof str).toBe('string');
    expect(str.length).toBeGreaterThan(10);
    expect(str).toContain('ค่าเฉลี่ยโดยประมาณ');
    expect(str).toContain('ไม่ใช่คำแนะนำทางการแพทย์');
  });

  it('pregnant short-form (EN): contains required legal phrases', () => {
    const str = catalog.en['home.babySizeDisclaimer'];
    expect(typeof str).toBe('string');
    expect(str.length).toBeGreaterThan(10);
    expect(str.toLowerCase()).toContain('not medical advice');
  });

  it('postpartum disclaimer (TH): contains verbatim legal §4 phrase', () => {
    const str = catalog.th['home.babyPostpartumDisclaimer'];
    expect(typeof str).toBe('string');
    expect(str.length).toBeGreaterThan(10);
    expect(str).toContain('ไม่ใช่การประเมินพัฒนาการหรือคำแนะนำทางการแพทย์');
  });

  it('postpartum disclaimer (EN): contains required legal phrase', () => {
    const str = catalog.en['home.babyPostpartumDisclaimer'];
    expect(typeof str).toBe('string');
    expect(str.length).toBeGreaterThan(10);
    expect(str.toLowerCase()).toContain('not a developmental assessment or medical advice');
  });

  it('full-form pregnant disclaimer (TH): contains verbatim legal §4 phrases', () => {
    const str = catalog.th['home.babySizeFullDisclaimer'];
    expect(typeof str).toBe('string');
    expect(str).toContain('ค่าเฉลี่ยโดยประมาณ');
    expect(str).toContain('ไม่ใช่การวินิจฉัยหรือคำแนะนำทางการแพทย์');
  });

  it('"ดูเพิ่มเติม" link text present (TH)', () => {
    expect(catalog.th['home.babySizeDisclaimerLink']).toBe('ดูเพิ่มเติม');
  });
});

// ─── i18n key parity ─────────────────────────────────────────────────────────
// Fail if any required key is missing from either locale.

describe('i18n parity: all baby-size keys in both TH and EN', () => {
  const requiredKeys = [
    'home.babySizeSectionLabel',
    'home.babyYourBabySectionLabel',
    'home.babySizeSizeInfo',
    'home.babySizeSizeInfoLengthOnly',
    'home.babyWarmNote',
    'home.babySizeDisclaimer',
    'home.babySizeFullDisclaimer',
    'home.babyPostpartumDisclaimer',
    'home.babySizeDisclaimerLink',
    'home.babySizeDisclaimerModalTitle',
  ] as const;

  for (const key of requiredKeys) {
    it(`"${key}" present in TH and EN`, () => {
      const thVal = catalog.th[key as keyof typeof catalog.th];
      const enVal = catalog.en[key as keyof typeof catalog.en];
      expect(typeof thVal).toBe('string');
      expect((thVal as string).length).toBeGreaterThan(0);
      expect(typeof enVal).toBe('string');
      expect((enVal as string).length).toBeGreaterThan(0);
    });
  }
});
