/**
 * doctorReportAssembler.test.ts — TDD for on-device doctor-report assembly.
 *
 * Covers (spec: pdf-doctor-ui.md §3):
 *   - buildDoctorReportHtml returns a non-empty HTML string
 *   - Profile section included (EDD, gestational week, lifecycle)
 *   - Medication & adherence section (first, always — placeholder when no data)
 *   - Kick-count section (date-range filtered)
 *   - Self-logs section — real data rendered verbatim; empty-range wording; gating
 *   - Appointments section (date-range filtered)
 *   - Lab results hidden line (when includeSensitiveNotes=false)
 *   - Date range filtering: data outside range is NOT included
 *   - Thai (th) + English (en) locale labels both work
 *   - Empty inputs for all sections → no crash, empty-state text (never "error")
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
  type ReportSelfLog,
  type ReportMedicationPlan,
  type ReportMedicationLog,
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

// ─── Self-log fixtures (decoded plaintext values — no base64 here) ─────────────

/** Blood-pressure log within range */
const selfLogBP: ReportSelfLog = {
  id: 'sl-bp1',
  loggedAt: '2026-07-01T13:00',
  metricType: 'blood_pressure',
  valueNumeric: '120',
  valueNumericSecondary: '78',
  valueText: null,
  unit: 'mmHg',
  note: null,
};

/** Weight log within range */
const selfLogWeight: ReportSelfLog = {
  id: 'sl-w1',
  loggedAt: '2026-07-02T09:00',
  metricType: 'weight',
  valueNumeric: '64.2',
  valueNumericSecondary: null,
  valueText: null,
  unit: 'kg',
  note: null,
};

/** Swelling log within range (valueText field — gated by includeSensitiveNotes) */
const selfLogSwelling: ReportSelfLog = {
  id: 'sl-sw1',
  loggedAt: '2026-07-03T10:00',
  metricType: 'swelling',
  valueNumeric: null,
  valueNumericSecondary: null,
  valueText: 'เล็กน้อย',
  unit: null,
  note: null,
};

/** Weight log with a note (note gated by includeSensitiveNotes) */
const selfLogWithNote: ReportSelfLog = {
  id: 'sl-note',
  loggedAt: '2026-07-05T08:00',
  metricType: 'weight',
  valueNumeric: '65.0',
  valueNumericSecondary: null,
  valueText: null,
  unit: 'kg',
  note: 'หมายเหตุพิเศษ',
};

/** Weight log OUTSIDE the date range — must be excluded */
const selfLogOutOfRange: ReportSelfLog = {
  id: 'sl-oor',
  loggedAt: '2026-05-15T09:00',   // before dateFrom 2026-07-01
  metricType: 'weight',
  valueNumeric: '99.9',
  valueNumericSecondary: null,
  valueText: null,
  unit: 'kg',
  note: null,
};

/** Extreme BP — must render identically to normal BP (INV-S1 / AC-20) */
const selfLogBPExtreme: ReportSelfLog = {
  id: 'sl-bp-x',
  loggedAt: '2026-07-04T08:00',
  metricType: 'blood_pressure',
  valueNumeric: '150',
  valueNumericSecondary: '95',
  valueText: null,
  unit: 'mmHg',
  note: null,
};

/** Normal BP for INV-S1 comparison */
const selfLogBPNormal: ReportSelfLog = {
  id: 'sl-bp-n',
  loggedAt: '2026-07-05T08:00',
  metricType: 'blood_pressure',
  valueNumeric: '110',
  valueNumericSecondary: '70',
  valueText: null,
  unit: 'mmHg',
  note: null,
};

/** Returns a fresh array of all self-logs that fall within the base date range */
function selfLogsInRange(): ReportSelfLog[] {
  return [selfLogBP, selfLogWeight, selfLogSwelling];
}

const baseInput: DoctorReportInput = {
  profile: baseProfile,
  kickSessions,
  appointments,
  selfLogs: [],
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

  it('renders empty-range wording when no medication data in range (th)', () => {
    // Once the medication section is data-driven, empty plans+logs → "ไม่มีข้อมูลในช่วงนี้"
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/ไม่มีข้อมูลในช่วงนี้/);
    // Must NOT render the old "feature not yet built" placeholder
    expect(html).not.toMatch(/ฟีเจอร์บันทึกยายังไม่ถูกสร้าง/);
  });

  it('renders empty-range wording when no medication data in range (en)', () => {
    // Once the medication section is data-driven, empty plans+logs → "No data in this range"
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/No data in this range/i);
    // Must NOT render the old placeholder
    expect(html).not.toMatch(/medication logging feature not yet built/i);
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

  // ── Self-logs section (spec §3) ────────────────────────────────────────────

  it('includes self-logs section header (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'th' });
    expect(html).toMatch(/บันทึกตนเอง|น้ำหนัก|ความดัน/i);
  });

  it('includes self-logs section header (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en' });
    expect(html).toMatch(/self-log|weight|blood pressure/i);
  });

  it('renders empty-range wording when selfLogs is empty — NOT old "feature not built" (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, selfLogs: [], locale: 'th' });
    expect(html).toMatch(/ไม่มีข้อมูลในช่วงนี้/i);
    expect(html).not.toMatch(/ฟีเจอร์บันทึกตนเองยังไม่ถูกสร้าง/);
  });

  it('renders empty-range wording when selfLogs is empty — NOT old "feature not built" (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, selfLogs: [], locale: 'en' });
    expect(html).toMatch(/no data in this range/i);
    expect(html).not.toMatch(/self-log feature not yet built/i);
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

  // ── Self-log section — real data (spec §A.4, pdf-doctor-ui §3) ───────────

  it('renders BP value verbatim: ความดัน 120/78 mmHg (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, selfLogs: [selfLogBP] });
    expect(html).toContain('ความดัน 120/78 mmHg');
  });

  it('renders weight value verbatim: น้ำหนัก 64.2 กก. (th)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, selfLogs: [selfLogWeight] });
    expect(html).toContain('น้ำหนัก 64.2 กก.');
  });

  it('renders BP value verbatim: Blood pressure 120/78 mmHg (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en', selfLogs: [selfLogBP] });
    expect(html).toContain('Blood pressure 120/78 mmHg');
  });

  it('renders weight value verbatim: Weight 64.2 kg (en)', () => {
    const html = buildDoctorReportHtml({ ...baseInput, locale: 'en', selfLogs: [selfLogWeight] });
    expect(html).toContain('Weight 64.2 kg');
  });

  it('excludes self-log outside date range', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [...selfLogsInRange(), selfLogOutOfRange],
    });
    // selfLogOutOfRange has valueNumeric '99.9' — must NOT appear in self-log value
    expect(html).not.toContain('99.9');
  });

  it('includes self-logs exactly on the lower boundary', () => {
    const onBoundary: ReportSelfLog = {
      id: 'sl-boundary',
      loggedAt: '2026-07-01T00:00',   // exactly dateFrom
      metricType: 'weight',
      valueNumeric: '55.5',
      valueNumericSecondary: null,
      valueText: null,
      unit: 'kg',
      note: null,
    };
    const html = buildDoctorReportHtml({ ...baseInput, selfLogs: [onBoundary] });
    expect(html).toContain('55.5');
  });

  // weight/BP always shown (numeric values — not gated by includeSensitiveNotes)
  it('BP value rendered when includeSensitiveNotes=false (always-render numeric)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogBP],
      includeSensitiveNotes: false,
    });
    expect(html).toContain('ความดัน 120/78 mmHg');
  });

  it('weight value rendered when includeSensitiveNotes=false (always-render numeric)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogWeight],
      includeSensitiveNotes: false,
    });
    expect(html).toContain('น้ำหนัก 64.2 กก.');
  });

  // swelling valueText gated by includeSensitiveNotes (spec §A.4 / G-5)
  it('swelling value hidden when includeSensitiveNotes=false — label + hidden-line shown', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogSwelling],
      includeSensitiveNotes: false,
    });
    // Label "บวม" must appear
    expect(html).toMatch(/บวม/i);
    // Value must NOT appear
    expect(html).not.toContain('เล็กน้อย');
    // A "results hidden" marker must appear inside the self-log section
    expect(html).toMatch(/ผลถูกซ่อน/i);
  });

  it('swelling value shown when includeSensitiveNotes=true', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogSwelling],
      includeSensitiveNotes: true,
    });
    expect(html).toContain('เล็กน้อย');
  });

  // note gated by includeSensitiveNotes (any metricType)
  it('note hidden when includeSensitiveNotes=false', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogWithNote],
      includeSensitiveNotes: false,
    });
    expect(html).not.toContain('หมายเหตุพิเศษ');
  });

  it('note shown when includeSensitiveNotes=true', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogWithNote],
      includeSensitiveNotes: true,
    });
    expect(html).toContain('หมายเหตุพิเศษ');
  });

  // INV-S1: extreme vs normal BP — identical HTML structure (no grading, AC-20)
  it('INV-S1: BP 150/95 and 110/70 render with identical surrounding HTML structure (no grading)', () => {
    // Use same loggedAt so only the numeric values differ
    const extremeLog: ReportSelfLog = { ...selfLogBPExtreme, loggedAt: '2026-07-04T08:00' };
    const normalLog: ReportSelfLog = { ...selfLogBPNormal, loggedAt: '2026-07-04T08:00' };

    const makeHtml = (log: ReportSelfLog) =>
      buildDoctorReportHtml({ ...baseInput, selfLogs: [log], locale: 'th' });

    const htmlExtreme = makeHtml(extremeLog);
    const htmlNormal = makeHtml(normalLog);

    // Strip out the numeric values themselves — everything else (tags, classes, structure) must match
    const normalise = (html: string, systolic: string, diastolic: string) =>
      html.replace(`${systolic}/${diastolic}`, 'SYS/DIA');

    const normExtreme = normalise(htmlExtreme, '150', '95');
    const normNormal = normalise(htmlNormal, '110', '70');

    // After normalising the value, surrounding HTML must be byte-identical (no conditional styling)
    expect(normExtreme).toBe(normNormal);
  });

  it('INV-S1: no grade words in self-log section for any value', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogBPExtreme, selfLogBPNormal, selfLogWeight],
      includeSensitiveNotes: true,
    });
    expect(html).not.toMatch(/normal|high|low|abnormal|สูง|ต่ำ|ผิดปกติ/i);
  });

  it('empty-range wording used when all self-logs are outside range (NOT old placeholder)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogOutOfRange],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    expect(html).toMatch(/ไม่มีข้อมูลในช่วงนี้/i);
    expect(html).not.toMatch(/ฟีเจอร์บันทึกตนเองยังไม่ถูกสร้าง/);
  });

  it('multiple self-logs in range all rendered (mixed metricTypes)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      selfLogs: [selfLogBP, selfLogWeight],
      includeSensitiveNotes: true,
    });
    expect(html).toContain('ความดัน 120/78 mmHg');
    expect(html).toContain('น้ำหนัก 64.2 กก.');
  });

  // ── Medication & adherence section — data-driven (§A.5 / RULING 7.2) ─────

  // Medication plan fixtures for assembler tests (decoded plaintext — no base64)
  const medPlanDaily: ReportMedicationPlan = {
    id: 'mp-1',
    name: 'Triferdine',
    dose: '150 mg',
    scheduleRule: {
      freq: 'daily',
      startAt: '2026-07-01T08:00',
      timesOfDay: ['08:00'],
    },
    active: true,
    deletedAt: null,
  };

  const medPlanPrn: ReportMedicationPlan = {
    id: 'mp-prn',
    name: 'Paracetamol',
    dose: '500 mg',
    scheduleRule: null,
    active: true,
    deletedAt: null,
  };

  const medPlanDeleted: ReportMedicationPlan = {
    id: 'mp-del',
    name: 'Old Iron',
    dose: null,
    scheduleRule: {
      freq: 'daily',
      startAt: '2026-07-01T08:00',
      timesOfDay: ['08:00'],
    },
    active: true,
    deletedAt: '2026-07-10T00:00:00Z',
  };

  it('renders plan name and N/M วัน adherence count for scheduled plan (th)', () => {
    // 27 taken logs out of 31 scheduled days in July
    const takenLogs: ReportMedicationLog[] = Array.from({ length: 27 }, (_, i) => ({
      id: `ml-${i}`,
      medicationPlanId: 'mp-1',
      occurrenceTime: `2026-07-${String(i + 1).padStart(2, '0')}T08:00`,
      status: 'taken' as const,
      note: null,
    }));
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [medPlanDaily],
      medicationLogs: takenLogs,
    });
    expect(html).toContain('Triferdine');
    expect(html).toContain('150 mg');
    // Adherence: 27 taken days out of 31 scheduled days in July
    expect(html).toContain('กินแล้ว 27/31 วัน');
    // Must not contain grade words (AC-20 / INV-M1)
    expect(html).not.toMatch(/poor|good|low|high|ดีมาก|แย่|ผิดปกติ/i);
  });

  it('renders N/M days adherence for en locale', () => {
    const takenLogs: ReportMedicationLog[] = [
      { id: 'ml-e1', medicationPlanId: 'mp-1', occurrenceTime: '2026-07-01T08:00', status: 'taken', note: null },
    ];
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'en',
      medicationPlans: [medPlanDaily],
      medicationLogs: takenLogs,
    });
    expect(html).toContain('Triferdine');
    // en adherence line: "Taken 1/31 days"
    expect(html).toContain('Taken 1/31 days');
  });

  it('renders N ครั้ง (PRN count) for PRN plan (th)', () => {
    const prnLogs: ReportMedicationLog[] = [
      { id: 'prn-1', medicationPlanId: 'mp-prn', occurrenceTime: '2026-07-05T10:00', status: 'taken', note: null },
      { id: 'prn-2', medicationPlanId: 'mp-prn', occurrenceTime: '2026-07-10T10:00', status: 'taken', note: null },
    ];
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [medPlanPrn],
      medicationLogs: prnLogs,
    });
    expect(html).toContain('Paracetamol');
    expect(html).toContain('กินแล้ว 2 ครั้ง');
    // Must NOT render a ratio (no M denominator for PRN)
    expect(html).not.toMatch(/กินแล้ว \d+\/\d+ วัน/);
  });

  it('renders N times (PRN count) for en locale', () => {
    const prnLog: ReportMedicationLog = {
      id: 'prn-en', medicationPlanId: 'mp-prn', occurrenceTime: '2026-07-05T10:00', status: 'taken', note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'en',
      medicationPlans: [medPlanPrn],
      medicationLogs: [prnLog],
    });
    expect(html).toContain('Taken 1 times');
  });

  it('deleted plan is NOT in the scored set — no N/M ratio rendered for it', () => {
    const deletedLog: ReportMedicationLog = {
      id: 'del-l', medicationPlanId: 'mp-del', occurrenceTime: '2026-07-05T08:00', status: 'taken', note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [medPlanDeleted],
      medicationLogs: [deletedLog],
    });
    // Deleted plan must not produce a N/M ratio line
    expect(html).not.toMatch(/กินแล้ว \d+\/\d+ วัน/);
  });

  it('missed logs are NOT counted toward N (missed day lowers fraction)', () => {
    const missedLog: ReportMedicationLog = {
      id: 'miss-1', medicationPlanId: 'mp-1', occurrenceTime: '2026-07-01T08:00', status: 'missed', note: null,
    };
    const takenLog: ReportMedicationLog = {
      id: 'take-1', medicationPlanId: 'mp-1', occurrenceTime: '2026-07-02T08:00', status: 'taken', note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [medPlanDaily],
      medicationLogs: [missedLog, takenLog],
    });
    // N=1 (only Jul 2 taken), M=31
    expect(html).toContain('กินแล้ว 1/31 วัน');
  });

  it('ad-hoc logs (null medicationPlanId) are listed separately, not in any plan ratio', () => {
    const adHoc: ReportMedicationLog = {
      id: 'ah-1', medicationPlanId: null, occurrenceTime: '2026-07-08T10:00', status: 'taken', note: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [medPlanDaily],
      medicationLogs: [adHoc],
    });
    // dailyPlan N=0 (adHoc not counted toward it)
    expect(html).toContain('กินแล้ว 0/31 วัน');
  });

  it('medication log note is hidden when includeSensitiveNotes=false', () => {
    const logWithNote: ReportMedicationLog = {
      id: 'note-1', medicationPlanId: 'mp-1',
      occurrenceTime: '2026-07-01T08:00', status: 'taken', note: 'Take with food',
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      medicationPlans: [medPlanDaily],
      medicationLogs: [logWithNote],
      includeSensitiveNotes: false,
    });
    expect(html).not.toContain('Take with food');
  });

  it('medication log note is shown when includeSensitiveNotes=true', () => {
    const logWithNote: ReportMedicationLog = {
      id: 'note-2', medicationPlanId: 'mp-1',
      occurrenceTime: '2026-07-01T08:00', status: 'taken', note: 'Take with food',
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      medicationPlans: [medPlanDaily],
      medicationLogs: [logWithNote],
      includeSensitiveNotes: true,
    });
    expect(html).toContain('Take with food');
  });

  it('INV-M1: 1/31 and 1/10 render with identical surrounding HTML structure (no grading)', () => {
    // Analogous to INV-S1: identical log content + dates; only M denominator differs.
    // A high-adherence fraction and a low-adherence fraction must have identical HTML structure.
    const planFull: ReportMedicationPlan = {
      id: 'mp-full',
      name: 'Triferdine',
      dose: '150 mg',
      scheduleRule: { freq: 'daily', startAt: '2026-07-01T08:00', timesOfDay: ['08:00'] },
      active: true,
      deletedAt: null,
    };
    const planShort: ReportMedicationPlan = {
      id: 'mp-short',
      name: 'Triferdine',
      dose: '150 mg',
      scheduleRule: { freq: 'daily', startAt: '2026-07-01T08:00', timesOfDay: ['08:00'], until: '2026-07-10' },
      active: true,
      deletedAt: null,
    };

    const logFull: ReportMedicationLog = {
      id: 'l-full', medicationPlanId: 'mp-full',
      occurrenceTime: '2026-07-01T08:00', status: 'taken', note: null,
    };
    const logShort: ReportMedicationLog = {
      id: 'l-short', medicationPlanId: 'mp-short',
      occurrenceTime: '2026-07-01T08:00', status: 'taken', note: null,
    };

    const htmlFull  = buildDoctorReportHtml({ ...baseInput, locale: 'th', medicationPlans: [planFull],  medicationLogs: [logFull]  });
    const htmlShort = buildDoctorReportHtml({ ...baseInput, locale: 'th', medicationPlans: [planShort], medicationLogs: [logShort] });

    // After replacing only the M denominator, the entire HTML is byte-identical (no conditional styling)
    const normFull  = htmlFull.replace('กินแล้ว 1/31 วัน',  'กินแล้ว 1/M วัน');
    const normShort = htmlShort.replace('กินแล้ว 1/10 วัน', 'กินแล้ว 1/M วัน');

    expect(normFull).toBe(normShort);
  });

  it('no grade words in medication section for any adherence fraction (AC-20)', () => {
    const logs: ReportMedicationLog[] = [
      { id: 'gl-1', medicationPlanId: 'mp-1', occurrenceTime: '2026-07-01T08:00', status: 'taken', note: null },
    ];
    const html = buildDoctorReportHtml({
      ...baseInput,
      medicationPlans: [medPlanDaily],
      medicationLogs: logs,
    });
    // These words must never appear in the medication section (or anywhere else)
    expect(html).not.toMatch(/good adherence|poor adherence|high adherence|low adherence/i);
    expect(html).not.toMatch(/สูง|ต่ำ|ดี|แย่|ผิดปกติ|สม่ำเสมอ/i);
  });

  it('medication section has section header even with real data', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [medPlanDaily],
      medicationLogs: [],
    });
    expect(html).toMatch(/ยา|การกินยา|Medication/i);
  });

  it('empty plans+logs renders section header + empty-range wording (NOT old placeholder)', () => {
    const html = buildDoctorReportHtml({
      ...baseInput,
      locale: 'th',
      medicationPlans: [],
      medicationLogs: [],
    });
    expect(html).toMatch(/ไม่มีข้อมูลในช่วงนี้/);
    expect(html).not.toMatch(/ฟีเจอร์บันทึกยายังไม่ถูกสร้าง/);
    expect(html).not.toMatch(/not tracked yet/i);
  });

  it('dose omitted from plan header when plan has no dose', () => {
    const noDosePlan: ReportMedicationPlan = {
      ...medPlanDaily,
      id: 'mp-nodose',
      dose: null,
    };
    const html = buildDoctorReportHtml({
      ...baseInput,
      medicationPlans: [noDosePlan],
      medicationLogs: [],
    });
    expect(html).toContain('Triferdine');
    // No stray "null" or "undefined" in the output
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });
});
