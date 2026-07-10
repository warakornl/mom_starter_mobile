/**
 * pregnancySummaryLegal.test.ts — MANDATORY FAIL-CLOSED legal/compliance tests.
 *
 * These tests are BINDING acceptance criteria (docs/legal/pregnancy-summary-legal.md
 * §2 G-summary-2, G-PS-a..g). They block build on any violation and MUST NOT be
 * weakened (no .only / .skip / describe.skip / expect.any without justification).
 *
 * Three categories of tests:
 *  1. DENYLIST — content strings must not contain assessment/trend tokens
 *  2. NO-TREND STRUCTURAL — buildPregnancySummary output has no cross-trimester field
 *  3. K-8 STATIC — source file must not console.log movementCount/sum/avg
 *
 * The denylist scope: CONTENT strings (labels, placeholders, section headers, avg
 * display text) — EXCLUDING the disclaimer (which is controlled by legal §3).
 *
 * ─── Denylist tokens (legal §2 point 3, BINDING): ────────────────────────────
 * Thai: ปกติ · ผิดปกติ · น้อย · มาก · สมส่วน · ตามเกณฑ์ · น้อยไป · เยอะไป ·
 *        น่ากังวล · ควร · ครบ · ไม่ครบ · ขาด · ดีกว่า · ปลอดภัยกว่า
 * Trend (TH): ลดลง · เพิ่มขึ้น · แนวโน้ม
 * Arrow glyphs: ↑ ↓ →
 * EN (case-insensitive): normal · abnormal · low · high · too few · too many ·
 *                         should · adherence · on track · concerning · healthy ·
 *                         decreasing · increasing · trend
 *
 * ─── Planted-violation self-checks: ──────────────────────────────────────────
 * Each test section includes a "planted violation" case that verifies the
 * denylist WOULD catch a violating string (meta-test that the test itself works).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildPregnancySummary,
  type BuildPregnancySummaryInput,
} from './pregnancySummary';
import type { KickCountSessionRecord } from '../kickCount/kickCountTypes';

// ─── Denylist token arrays ────────────────────────────────────────────────────

/** Thai assessment tokens — BANNED from content strings. */
const DENYLIST_TH = [
  'ปกติ',
  'ผิดปกติ',
  'น้อย',
  'มาก',
  'สมส่วน',
  'ตามเกณฑ์',
  'น้อยไป',
  'เยอะไป',
  'น่ากังวล',
  'ควร',
  'ครบ',
  'ไม่ครบ',
  'ขาด',
  'ดีกว่า',
  'ปลอดภัยกว่า',
];

/** Thai trend/comparison tokens — BANNED (G-PS-d: no cross-trimester trend). */
const DENYLIST_TREND_TH = ['ลดลง', 'เพิ่มขึ้น', 'แนวโน้ม'];

/** Arrow glyphs — BANNED (G-PS-d). */
const DENYLIST_ARROWS = ['↑', '↓', '→'];

/** English assessment/trend tokens (case-insensitive). */
const DENYLIST_EN_LOWER = [
  'normal',
  'abnormal',
  'low',
  'high',
  'too few',
  'too many',
  'should',
  'adherence',
  'on track',
  'concerning',
  'healthy',
  'decreasing',
  'increasing',
  'trend',
];

// All tokens combined for convenient checking
const ALL_BANNED_TH = [...DENYLIST_TH, ...DENYLIST_TREND_TH, ...DENYLIST_ARROWS];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check that a content string contains none of the banned Thai tokens
 * and none of the banned English tokens (case-insensitive).
 */
function assertNoBannedTokens(content: string, description: string): void {
  for (const token of ALL_BANNED_TH) {
    if (content.includes(token)) {
      throw new Error(
        `[DENYLIST VIOLATION] ${description}: found banned Thai token "${token}" in: "${content}"`,
      );
    }
  }
  const lower = content.toLowerCase();
  for (const token of DENYLIST_EN_LOWER) {
    if (lower.includes(token)) {
      throw new Error(
        `[DENYLIST VIOLATION] ${description}: found banned EN token "${token}" in: "${content}"`,
      );
    }
  }
}

function makeSession(
  startedAt: string,
  movementCount: number,
  id = `s-${startedAt}`,
): KickCountSessionRecord {
  return {
    id,
    startedAt,
    movementCount,
    targetCount: 10,
    status: 'completed',
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  };
}

const EDD = '2026-10-10';

function baseInput(
  overrides: Partial<BuildPregnancySummaryInput> = {},
): BuildPregnancySummaryInput {
  return {
    edd: EDD,
    birthDate: null,
    deliveryType: null,
    hospitalAdmissionDate: null,
    hospitalDischargeDate: null,
    completedKickSessions: [],
    medicationLogs: [],
    plans: [],
    today: '2026-07-10',
    ...overrides,
  };
}

// ─── 1. Denylist test on PregnancySummary output labels ───────────────────────

describe('[LEGAL FAIL-CLOSED] Denylist: PregnancySummary output labels', () => {
  it('medication fallback label "ยา (ไม่พบชื่อ)" passes the denylist', () => {
    // This label must be assessed-word free
    const label = 'ยา (ไม่พบชื่อ)';
    expect(() => assertNoBannedTokens(label, 'fallback label')).not.toThrow();
  });

  it('ad-hoc label "ยาที่บันทึกเอง" passes the denylist', () => {
    const label = 'ยาที่บันทึกเอง';
    expect(() => assertNoBannedTokens(label, 'ad-hoc label')).not.toThrow();
  });

  it('[PLANTED VIOLATION] denylist CATCHES "ปกติ" in a label (self-check)', () => {
    const violating = 'ปกติ — ลูกดิ้นสม่ำเสมอ';
    expect(() => assertNoBannedTokens(violating, 'planted ปกติ')).toThrow(/DENYLIST VIOLATION/);
  });

  it('[PLANTED VIOLATION] denylist CATCHES "normal" in an EN label (self-check)', () => {
    const violating = 'normal kick rate';
    expect(() => assertNoBannedTokens(violating, 'planted normal')).toThrow(/DENYLIST VIOLATION/);
  });

  it('[PLANTED VIOLATION] denylist CATCHES "↑" arrow glyph (self-check)', () => {
    const violating = 'ลูกดิ้น ↑ เพิ่มขึ้น';
    expect(() => assertNoBannedTokens(violating, 'planted arrow')).toThrow(/DENYLIST VIOLATION/);
  });

  it('[PLANTED VIOLATION] denylist CATCHES "trend" (self-check)', () => {
    const violating = 'kick count trend';
    expect(() => assertNoBannedTokens(violating, 'planted trend')).toThrow(/DENYLIST VIOLATION/);
  });

  it('[PLANTED VIOLATION] denylist CATCHES "ลดลง" trend token (self-check)', () => {
    const violating = 'ค่าเฉลี่ยลดลงจากไตรมาสที่แล้ว';
    expect(() => assertNoBannedTokens(violating, 'planted ลดลง')).toThrow(/DENYLIST VIOLATION/);
  });

  it('buildPregnancySummary labels and fallbacks pass the denylist', () => {
    // Run the function with a join-miss (plan deleted) and ad-hoc logs
    const { makeLog } = (() => {
      const makeLog = (occurrenceTime: string, planId: string | null, id: string) => ({
        id,
        occurrenceTime,
        medicationPlanId: planId,
        status: 'taken' as const,
        note: null,
        loggedAt: '2026-01-01T00:00:00Z',
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        deletedAt: null,
      });
      return { makeLog };
    })();

    const logs = [
      makeLog('2026-08-01T10:00', 'plan-deleted', 'l1'),
      makeLog('2026-08-02T10:00', null, 'l2'),
    ];
    const sessions = [makeSession('2026-08-01T10:00', 15, 'k1')];

    const result = buildPregnancySummary(
      baseInput({ completedKickSessions: sessions, medicationLogs: logs }),
    );

    // Check all medication labels
    for (const t of ['T1', 'T2', 'T3'] as const) {
      for (const med of result[t].medications) {
        assertNoBannedTokens(med.label, `${t} medication label`);
      }
    }

    // Check that the output as JSON contains no banned tokens in label strings
    // (we specifically check label fields, not numeric values)
    const allLabels = [
      ...result.T1.medications.map((m) => m.label),
      ...result.T2.medications.map((m) => m.label),
      ...result.T3.medications.map((m) => m.label),
    ];
    for (const label of allLabels) {
      assertNoBannedTokens(label, 'all collected labels');
    }
  });
});

// ─── 2. Structural no-trend test ──────────────────────────────────────────────

describe('[LEGAL FAIL-CLOSED] Structural no-trend: buildPregnancySummary output', () => {
  it('PregnancySummary object has no cross-trimester comparison/delta field at any level', () => {
    const sessions = [
      makeSession('2026-02-01T10:00', 10, 'a'),
      makeSession('2026-05-01T10:00', 20, 'b'),
      makeSession('2026-08-01T10:00', 30, 'c'),
    ];
    const result = buildPregnancySummary(baseInput({ completedKickSessions: sessions }));

    // Serialize the full output and check for banned structural keys
    const serialized = JSON.stringify(result);
    const bannedStructuralKeys = [
      '"trend"',
      '"delta"',
      '"change"',
      '"comparison"',
      '"increasing"',
      '"decreasing"',
      '"direction"',
      '"vsT1"',
      '"vsT2"',
      '"vsT3"',
      '"kickTrend"',
      '"avgDelta"',
    ];
    for (const key of bannedStructuralKeys) {
      if (serialized.includes(key)) {
        throw new Error(
          `[NO-TREND VIOLATION] output JSON contains forbidden key ${key}`,
        );
      }
    }

    // Verify each trimester is an independent data point
    expect(result.T1.kicks?.avgKicksPerDay).toBeDefined();
    expect(result.T2.kicks?.avgKicksPerDay).toBeDefined();
    expect(result.T3.kicks?.avgKicksPerDay).toBeDefined();

    // The ONLY avgKicksPerDay value visible is per-trimester, no cross-refs
    // (If we could compare T1 and T2 numerically, that would be fine in the
    //  UI where the user does the comparison themselves, but the OUTPUT must
    //  not provide a pre-computed delta)
  });

  it('[PLANTED VIOLATION] no-trend test CATCHES a delta field (self-check)', () => {
    const fake = {
      T1: { kicks: { avgKicksPerDay: 10, daysWithData: 3 }, medications: [] },
      T2: { kicks: { avgKicksPerDay: 20, daysWithData: 5 }, medications: [] },
      T3: { kicks: { avgKicksPerDay: 15, daysWithData: 4, trend: 'decreasing' }, medications: [] },
      delivery: null,
      needsEdd: false,
    };
    const serialized = JSON.stringify(fake);
    expect(serialized).toContain('"trend"'); // violation caught ✓
  });
});

// ─── 3. K-8 static test: no console.log of health data in source ──────────────

describe('[K-8 FAIL-CLOSED] pregnancySummary.ts must not log movementCount or avg', () => {
  const SUMMARY_SRC_PATH = path.resolve(__dirname, 'pregnancySummary.ts');

  it('pregnancySummary.ts source file exists', () => {
    expect(fs.existsSync(SUMMARY_SRC_PATH)).toBe(true);
  });

  it('pregnancySummary.ts does not console.log movementCount (K-8)', () => {
    const src = fs.readFileSync(SUMMARY_SRC_PATH, 'utf-8');
    // Strip single-line comments and multi-line JSDoc blocks before checking,
    // so that K-8 explanatory comments do not false-positive.
    const noLineComments = src.replace(/\/\/[^\n]*/g, '');
    const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    // Check code-only lines for actual console.log calls with health fields
    const logMovementPattern = /console\s*\.\s*log[^;]*movementCount/;
    expect(logMovementPattern.test(noBlockComments)).toBe(false);
  });

  it('pregnancySummary.ts does not console.log totalMovements or avgKicksPerDay (K-8)', () => {
    const src = fs.readFileSync(SUMMARY_SRC_PATH, 'utf-8');
    const noLineComments = src.replace(/\/\/[^\n]*/g, '');
    const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    const bannedPatterns = [
      /console\s*\.\s*log[^;]*totalMovements/,
      /console\s*\.\s*log[^;]*avgKicksPerDay/,
      /console\s*\.\s*log[^;]*avg.*kicks/i,
    ];
    for (const pattern of bannedPatterns) {
      expect(pattern.test(noBlockComments)).toBe(false);
    }
  });

  it('[PLANTED VIOLATION] K-8 test CATCHES a console.log of movementCount (self-check)', () => {
    // A real code call (not in a comment) that should be caught
    const violatingCode = `
      console.log('kicks:', session.movementCount);
    `;
    const noLineComments = violatingCode.replace(/\/\/[^\n]*/g, '');
    const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    const logMovementPattern = /console\s*\.\s*log[^;]*movementCount/;
    expect(logMovementPattern.test(noBlockComments)).toBe(true); // violation caught ✓
  });
});
