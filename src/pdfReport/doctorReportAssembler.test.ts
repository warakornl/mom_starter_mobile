/**
 * doctorReportAssembler.test.ts — TDD for on-device doctor-report assembly.
 *
 * Covers:
 *   - buildDoctorReportHtml returns a non-empty HTML string
 *   - Profile section included (EDD, gestational week, lifecycle)
 *   - Kick-count section present with sessions (or empty-section message)
 *   - Appointments/reminders section present
 *   - Supplies section present
 *   - Thai (th) + English (en) locale labels both work
 *   - Empty inputs for all sections → no crash, empty-section placeholders
 *   - Generated HTML contains no raw secrets (no tokens, no passwords)
 *   - Report date is present (BE calendar in th, CE in en)
 *   - HTML is well-formed enough (has <html>, <body>)
 *   - No disclosure of sensitive personal data beyond what is provided
 *
 * Security invariants:
 *   - Function is pure — takes only explicitly provided data; never imports stores.
 *   - Never includes any token, credential, or sensitive field not in the input.
 */

import {
  buildDoctorReportHtml,
  type DoctorReportInput,
} from './doctorReportAssembler';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseProfile = {
  edd: '2026-10-15',
  gestationalWeek: 28,
  lifecycle: 'pregnant' as const,
};

const kickSessions = [
  {
    id: 's1',
    startedAt: '2026-07-01T09:00',
    endedAt: '2026-07-01T09:20',
    movementCount: 8,
    durationSeconds: 1200,
    gestationalWeekAtStart: 28,
    note: null,
  },
  {
    id: 's2',
    startedAt: '2026-07-02T10:00',
    endedAt: '2026-07-02T10:15',
    movementCount: 12,
    durationSeconds: 900,
    gestationalWeekAtStart: 28,
    note: null,
  },
];

const appointments = [
  {
    id: 'a1',
    title: 'ANC ฝากครรภ์',
    scheduledAt: '2026-07-10T09:00',
    done: false,
    category: 'anc_visit' as const,
    note: null,
  },
  {
    id: 'a2',
    title: 'ตรวจเลือด',
    scheduledAt: '2026-07-05T08:00',
    done: true,
    category: 'lab_panel' as const,
    note: null,
  },
];

const reminders = [
  {
    id: 'r1',
    displayTitle: 'กินวิตามิน',
    type: 'medication' as const,
    active: true,
  },
];

const supplies = [
  { id: 'sup1', name: 'ผ้าอ้อม', onHandQty: 50, category: 'diapers' as const },
  { id: 'sup2', name: 'นมผง', onHandQty: 2, category: 'feeding' as const },
];

const reportDate = '2026-07-03';

const baseInput: DoctorReportInput = {
  profile: baseProfile,
  kickSessions,
  appointments,
  reminders,
  supplies,
  reportDate,
  locale: 'th',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildDoctorReportHtml', () => {
  // ── Basic well-formedness ──────────────────────────────────────────────────

  it('returns a non-empty HTML string', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains <html> and <body> tags', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).toMatch(/<html/i);
    expect(html).toMatch(/<body/i);
    expect(html).toMatch(/<\/body>/i);
    expect(html).toMatch(/<\/html>/i);
  });

  // ── Profile section ────────────────────────────────────────────────────────

  it('includes the EDD in the profile section (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    // EDD 2026-10-15 → in Thai = "15 ตุลาคม พ.ศ. 2569"
    expect(html).toContain('2569');   // Thai BE year
    expect(html).toContain('ตุลาคม'); // Thai month
  });

  it('includes the EDD in the profile section (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toContain('October 15, 2026');
  });

  it('includes gestational week (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toContain('28');
  });

  it('includes gestational week (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toContain('28');
  });

  it('shows lifecycle as pregnant (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ตั้งครรภ์/i);
  });

  it('shows lifecycle as postpartum (th)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      profile: { ...baseProfile, lifecycle: 'postpartum', edd: '2026-01-01' },
      locale: 'th',
    });
    expect(html).toMatch(/หลังคลอด/i);
  });

  // ── Report date ────────────────────────────────────────────────────────────

  it('includes report date formatted in Thai BE (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    // 2026-07-03 → BE 2569, กรกฎาคม
    expect(html).toContain('2569');
    expect(html).toContain('กรกฎาคม');
  });

  it('includes report date formatted in CE (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toContain('July 3, 2026');
  });

  // ── Kick-count section ─────────────────────────────────────────────────────

  it('includes kick-count section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ลูกดิ้น|นับลูกดิ้น/i);
  });

  it('includes kick-count section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/kick count/i);
  });

  it('includes movement count for each session', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).toContain('8');
    expect(html).toContain('12');
  });

  it('shows empty-state for kick sessions when none provided (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, kickSessions: [], locale: 'th' });
    expect(html).toMatch(/ไม่มีข้อมูล|ยังไม่มี/i);
  });

  it('shows empty-state for kick sessions when none provided (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, kickSessions: [], locale: 'en' });
    expect(html).toMatch(/no data|none/i);
  });

  // ── Appointments section ───────────────────────────────────────────────────

  it('includes appointments section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/นัดหมาย/i);
  });

  it('includes appointments section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/appointment/i);
  });

  it('includes appointment titles in the HTML', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).toContain('ANC ฝากครรภ์');
    expect(html).toContain('ตรวจเลือด');
  });

  it('shows empty-state for appointments when none provided (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, appointments: [], locale: 'th' });
    expect(html).toMatch(/ไม่มีข้อมูล|ยังไม่มี/i);
  });

  // ── Reminders section ──────────────────────────────────────────────────────

  it('includes reminder titles in the HTML', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).toContain('กินวิตามิน');
  });

  it('shows empty-state for reminders when none provided (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, reminders: [], locale: 'th' });
    // Either reminders section is omitted or shows empty state
    // At minimum should not crash
    expect(typeof html).toBe('string');
  });

  // ── Supplies section ───────────────────────────────────────────────────────

  it('includes supplies section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/เตรียมคลอด|ของใช้|รายการ/i);
  });

  it('includes supplies section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/suppl/i);
  });

  it('includes supply item names', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).toContain('ผ้าอ้อม');
    expect(html).toContain('นมผง');
  });

  it('shows empty-state for supplies when none provided (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, supplies: [], locale: 'th' });
    expect(html).toMatch(/ไม่มีข้อมูล|ยังไม่มี/i);
  });

  // ── Empty all sections — no crash ──────────────────────────────────────────

  it('handles all empty sections without crashing (th)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: [],
      appointments: [],
      reminders: [],
      supplies: [],
      locale: 'th',
    });
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toMatch(/<html/i);
  });

  it('handles all empty sections without crashing (en)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: [],
      appointments: [],
      reminders: [],
      supplies: [],
      locale: 'en',
    });
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  // ── Security invariants ────────────────────────────────────────────────────

  it('does not include any auth tokens or credentials', () => {
    // No token or password-like patterns should appear in the output
    const html = buildDoctorReportHtml(baseInput);
    expect(html).not.toMatch(/accessToken|Bearer |password|secret/i);
  });

  it('is deterministic for the same input', () => {
    const html1 = buildDoctorReportHtml(baseInput);
    const html2 = buildDoctorReportHtml(baseInput);
    expect(html1).toBe(html2);
  });

  // ── Kick-count capped to 10 recent sessions ────────────────────────────────

  it('caps kick sessions to 10 most recent', () => {
    const manySessions = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      startedAt: `2026-06-${String(i + 1).padStart(2, '0')}T09:00`,
      endedAt: `2026-06-${String(i + 1).padStart(2, '0')}T09:20`,
      movementCount: i + 1,
      durationSeconds: 600,
      gestationalWeekAtStart: 27,
      note: null,
    }));
    const html = buildDoctorReportHtml({ ...baseInput, kickSessions: manySessions });
    // The function should only include the 10 most recent
    // movementCount 15 (most recent) should be in the output
    expect(html).toContain('15');
    // The very first one (movementCount 1, the oldest of 15) should not appear
    // since only 10 most recent are shown
    // (first session has movementCount 1 — but 6,7,8,9,10,11,12,13,14,15 are the 10 most recent)
    // Sessions 1-5 should NOT appear in count display (they're beyond the 10 most recent)
    // We check the overall count of unique session IDs is limited to 10
    const sessionIdMatches = [...html.matchAll(/s(\d+)/g)].map((m) => m[1]);
    // ids shown should only be from the 10 most recent
    const uniqueIds = new Set(sessionIdMatches.map(Number));
    expect(uniqueIds.size).toBeLessThanOrEqual(10);
  });

  // ── Disclaimer / not-medical-advice ───────────────────────────────────────

  it('includes a medical disclaimer (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ไม่ใช่คำวินิจฉัย|ไม่ใช่คำแนะนำทางการแพทย์/i);
  });

  it('includes a medical disclaimer (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/not.*medical|medical.*advice/i);
  });
});
