/**
 * doctorReportAssembler.test.ts — TDD for on-device doctor-report assembly.
 *
 * Covers (spec: pdf-doctor-ui.md §3):
 *   - buildDoctorReportHtml returns a non-empty HTML string
 *   - Profile section included (EDD, gestational week, lifecycle)
 *   - Medication & adherence section (first, always — placeholder when no data)
 *   - Kick-count section (date-range filtered)
 *   - Self-logs section (placeholder when no data source)
 *   - Appointments section (date-range filtered)
 *   - Lab results hidden line (when includeSensitiveNotes=false)
 *   - Date range filtering: data outside range is NOT included
 *   - Thai (th) + English (en) locale labels both work
 *   - Empty inputs for all sections → no crash, placeholder text (never "error")
 *   - Generated HTML contains no raw secrets (no tokens, no passwords)
 *   - Report date and range are present (BE calendar in th, CE in en)
 *   - HTML is well-formed enough (has <html>, <body>)
 *   - Disclaimer copy matches spec §7 mandated wording
 *   - Supplies section is NOT in the doctor report (spec §3 does not list it)
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

const reportDate = '2026-07-03';

const baseInput: DoctorReportInput = {
  profile: baseProfile,
  kickSessions,
  appointments,
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
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

  // ── Date range in report header ────────────────────────────────────────────

  it('shows the date range in the report header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    // dateFrom=2026-07-01 → 1 กรกฎาคม พ.ศ. 2569
    // dateTo=2026-07-31  → 31 กรกฎาคม พ.ศ. 2569
    expect(html).toContain('กรกฎาคม');
  });

  it('shows the date range in the report header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toContain('July 1, 2026');
    expect(html).toContain('July 31, 2026');
  });

  // ── Medication & adherence section (spec §3 — first, always) ───────────────

  it('includes medication section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ยา|การกินยา|ยาและการกินยา/i);
  });

  it('includes medication section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/medication|adherence/i);
  });

  it('renders medication placeholder when no medication data (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    // Placeholder since no medication tracking feature exists yet
    expect(html).toMatch(/ยังไม่มีข้อมูล|not tracked/i);
  });

  it('renders medication placeholder when no medication data (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/not tracked yet/i);
  });

  // ── Kick-count section ─────────────────────────────────────────────────────

  it('includes kick-count section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ลูกดิ้น|นับลูกดิ้น/i);
  });

  it('includes kick-count section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/kick.counts?/i);
  });

  it('includes movement count for sessions within range', () => {
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

  // ── Date range filtering — kick sessions ───────────────────────────────────

  it('excludes kick sessions outside the date range', () => {
    const outsideSession = {
      id: 'outside',
      startedAt: '2026-05-15T09:00',  // Before dateFrom 2026-07-01
      endedAt: '2026-05-15T09:20',
      movementCount: 99,
      durationSeconds: 600,
      gestationalWeekAtStart: 25,
      note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: [...kickSessions, outsideSession],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    // movementCount 99 from the outside session must NOT appear
    expect(html).not.toContain('>99<');
  });

  it('includes kick sessions exactly on the range boundary', () => {
    const onBoundary = {
      id: 'boundary',
      startedAt: '2026-07-01T00:00',
      endedAt: null,
      movementCount: 77,
      durationSeconds: null,
      gestationalWeekAtStart: null,
      note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: [onBoundary],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    expect(html).toContain('77');
  });

  // ── Self-logs section (spec §3 — placeholder since no data source) ──────────

  it('includes self-logs section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/บันทึกตนเอง|น้ำหนัก|ความดัน/i);
  });

  it('includes self-logs section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/self-log|weight|blood pressure/i);
  });

  it('renders self-log placeholder when no data (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ยังไม่มีข้อมูล|not tracked/i);
  });

  it('renders self-log placeholder when no data (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/not tracked yet/i);
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

  // ── Date range filtering — appointments ────────────────────────────────────

  it('excludes appointments outside the date range', () => {
    const outsideAppt = {
      id: 'old',
      title: 'นัดเก่า',
      scheduledAt: '2026-05-01T09:00',  // Before dateFrom 2026-07-01
      done: true,
      category: 'anc_visit' as const,
      note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      appointments: [...appointments, outsideAppt],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    expect(html).not.toContain('นัดเก่า');
  });

  it('includes undated appointments regardless of range (no scheduledAt)', () => {
    const undated = {
      id: 'undated',
      title: 'นัดไม่มีวันที่',
      scheduledAt: null,
      done: false,
      category: 'appointment' as const,
      note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      appointments: [undated],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    expect(html).toContain('นัดไม่มีวันที่');
  });

  // ── Lab results hidden line (spec §2.2/§3) ─────────────────────────────────

  it('includes "results hidden" line when includeSensitiveNotes is false (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, includeSensitiveNotes: false, locale: 'th' });
    expect(html).toMatch(/ผลถูกซ่อน|results hidden/i);
  });

  it('includes "results hidden" line when includeSensitiveNotes is omitted (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ผลถูกซ่อน|results hidden/i);
  });

  it('does NOT include "results hidden" line when includeSensitiveNotes is true', () => {
    const html = buildDoctorReportHtml({ ...baseInput, includeSensitiveNotes: true, locale: 'th' });
    // When notes are included, the "hidden" line should not appear
    expect(html).not.toMatch(/ผลถูกซ่อน/);
  });

  // ── Disclaimer — spec §7 mandated copy ────────────────────────────────────

  it('includes spec §7 Thai disclaimer copy', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/แอปไม่วินิจฉัย.*ไม่ให้คำแนะนำทางการแพทย์/i);
  });

  it('includes spec §7 English disclaimer copy', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/This app does not diagnose or give medical advice/i);
  });

  it('includes a note that the report is a personal record (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/บันทึกส่วนตัว|เพื่อแสดงต่อแพทย์/i);
  });

  // ── Supplies are NOT in the doctor report (spec §3) ───────────────────────

  it('does not include a supplies section (spec §3 does not list supplies)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    // "รายการเตรียมคลอด" is the supplies nav title — must not appear in doctor report
    expect(html).not.toMatch(/รายการเตรียมคลอด/i);
    expect(html).not.toMatch(/supply checklist/i);
  });

  // ── Empty all sections — no crash ──────────────────────────────────────────

  it('handles all empty sections without crashing (th)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: [],
      appointments: [],
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
      locale: 'en',
    });
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('renders a "no data in range" style report for empty range (us-10 AC)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: [],
      appointments: [],
      locale: 'th',
    });
    // Valid empty-range report — must still have structure (not an error)
    expect(html).toMatch(/<html/i);
    expect(html).toMatch(/ไม่มีข้อมูล|ยังไม่มี/i);
  });

  // ── Security invariants ────────────────────────────────────────────────────

  it('does not include any auth tokens or credentials', () => {
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
      startedAt: `2026-07-${String(i + 1).padStart(2, '0')}T09:00`,
      endedAt: `2026-07-${String(i + 1).padStart(2, '0')}T09:20`,
      movementCount: i + 1,
      durationSeconds: 600,
      gestationalWeekAtStart: 27,
      note: null,
    }));
    const html = buildDoctorReportHtml({
      ...baseInput,
      kickSessions: manySessions,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    // The most recent sessions have movementCounts 15, 14, ... 6
    expect(html).toContain('15');
    // Chart SVG renders at most 10 bars
    const rectMatches = [...html.matchAll(/<rect /g)];
    expect(rectMatches.length).toBeLessThanOrEqual(10);
  });

  // ── Kick-count SVG chart integration ─────────────────────────────────────

  it('kick-count section contains an inline <svg> bar chart', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).toContain('<svg ');
    expect(html).toContain('</svg>');
  });

  it('kick-count chart has one <rect> bar per session in range', () => {
    const html = buildDoctorReportHtml(baseInput); // 2 sessions in range
    const rectMatches = [...html.matchAll(/<rect /g)];
    expect(rectMatches.length).toBe(2);
  });

  it('kick-count chart SVG contains the value labels for each session', () => {
    const html = buildDoctorReportHtml(baseInput);
    // Session counts: 8 and 12
    expect(html).toContain('>8<');
    expect(html).toContain('>12<');
  });

  it('kick-count chart renders empty-state SVG (no <rect>) when no sessions', () => {
    const html = buildDoctorReportHtml({ ...baseInput, kickSessions: [] });
    expect(html).toContain('<svg ');
    expect(html).not.toContain('<rect');
  });

  it('kick-count section has a text summary line (total sessions · avg count)', () => {
    const html = buildDoctorReportHtml(baseInput);
    // 2 sessions, avg of [8,12] = 10
    expect(html).toMatch(/2.*session|2.*ครั้ง/i);
    expect(html).toMatch(/avg|เฉลี่ย/i);
  });

  it('K-5b: kick-count chart uses no red or green valence fill', () => {
    const html = buildDoctorReportHtml(baseInput);
    expect(html).not.toMatch(/fill="(red|green)"/i);
    expect(html).not.toMatch(/fill="#[Ff][Ff]0000"/);
    expect(html).not.toMatch(/fill="#00[Ff][Ff]00"/);
  });

  it('kick-count chart is deterministic (same input → same SVG)', () => {
    const html1 = buildDoctorReportHtml(baseInput);
    const html2 = buildDoctorReportHtml(baseInput);
    expect(html1).toBe(html2);
  });
});
