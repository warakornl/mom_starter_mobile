/**
 * doctorReportAssembler — pure on-device doctor-report HTML builder.
 *
 * This module is the testable core of the PDF-doctor feature.
 * It is PURE: takes explicit input, returns HTML — no side effects,
 * no store imports, no native calls.
 *
 * Design (spec: pdf-doctor-ui.md §3):
 *   - HTML → PDF via expo-print (Print.printToFileAsync) at the caller layer.
 *   - All sections are rendered from data the app already holds locally.
 *   - On-device only; NO health data is sent to a server (PDPA-friendly).
 *   - Locale-aware: Thai (th) uses BE years + Thai month names;
 *     English (en) uses CE dates.
 *   - Date-range filtering: only data within [dateFrom, dateTo] is included.
 *   - Capped to 10 most-recent kick sessions (within range) to keep PDF concise.
 *   - Deterministic for identical inputs (pure function).
 *
 * Report layout (spec §3 — ordered per spec):
 *   Header (report title, range, report-date, disclaimer)
 *   1. Pregnancy profile (lifecycle, EDD, gestational week)
 *   2. Medication & adherence (placeholder — medication logging not yet built)
 *   3. Kick-count sessions (date-range filtered, capped to 10)
 *   4. Self-logs weight/BP/swelling (placeholder — self-log feature not yet built)
 *   5. Appointments & checklist (date-range filtered)
 *   6. Lab/notes line — "ผลถูกซ่อน" when includeSensitiveNotes=false (spec §2.2)
 *   Footer: spec §7 mandatory disclaimer
 *
 * DATA-SOURCE GAPS (flagged for upstream):
 *   - Medication & adherence: no medication-logging feature exists in the app yet.
 *     Section renders with "ยังไม่มีข้อมูลในช่วงนี้ / not tracked yet" placeholder.
 *     Fully populating this section requires building the medication-log store first.
 *   - Self-logs (weight/BP/swelling): no self-logging feature exists yet.
 *     Same placeholder. Requires a self-log store to be built.
 *
 * Security:
 *   - NEVER include auth tokens, passwords, or any credential.
 *   - No sensitive data is logged (this module has no log calls).
 *   - The output HTML is written to a temp file by expo-print and
 *     only shared by explicit user action via expo-sharing.
 *   - includeSensitiveNotes=false (default): free-text notes are suppressed;
 *     a "results hidden" line replaces them (spec §2.2/§3, PDPA SD-7).
 */

import type { Locale } from '../auth/types';
import type { ChecklistItemCategory } from '../sync/syncTypes';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface ReportProfile {
  edd: string;
  gestationalWeek: number;
  lifecycle: 'pregnant' | 'postpartum' | 'ended';
}

export interface ReportKickSession {
  id: string;
  startedAt: string;
  endedAt: string | null | undefined;
  movementCount: number;
  durationSeconds: number | null | undefined;
  gestationalWeekAtStart: number | null | undefined;
  note: string | null | undefined;
}

export interface ReportAppointment {
  id: string;
  title: string;
  scheduledAt: string | null | undefined;
  done: boolean;
  category: ChecklistItemCategory;
  note: string | null | undefined;
}

export interface DoctorReportInput {
  profile: ReportProfile;
  kickSessions: ReportKickSession[];
  appointments: ReportAppointment[];
  /** Civil "YYYY-MM-DD" start of the report range (inclusive). */
  dateFrom: string;
  /** Civil "YYYY-MM-DD" end of the report range (inclusive). */
  dateTo: string;
  /**
   * Whether to include sensitive notes (lab results, free-text notes) in the PDF.
   * Defaults to false. When false, a "ผลถูกซ่อน / results hidden" line is printed.
   * Requires `sensitive_lab_results` consent to be true (spec §2.2, PDPA SD-7).
   */
  includeSensitiveNotes?: boolean;
  /** Civil "YYYY-MM-DD" date to stamp the report. */
  reportDate: string;
  locale: Locale;
}

// ─── Date formatting helpers ───────────────────────────────────────────────────

const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (locale === 'th') {
    return `${d} ${MONTHS_TH[m - 1]} พ.ศ. ${y + 543}`;
  }
  return `${MONTHS_EN[m - 1]} ${d}, ${y}`;
}

/** Format "YYYY-MM-DDTHH:mm" floating-civil datetime → date string only. */
function formatDateTime(floatingCivil: string, locale: Locale): string {
  const datePart = floatingCivil.substring(0, 10);
  const timePart = floatingCivil.substring(11, 16); // "HH:mm"
  const dateFormatted = formatDate(datePart, locale);
  return timePart ? `${dateFormatted} ${timePart}` : dateFormatted;
}

// ─── Date range helpers ────────────────────────────────────────────────────────

/**
 * Returns the civil date part (YYYY-MM-DD) from a floating-civil datetime
 * or civil date string.
 */
function civilDatePart(isoOrFloating: string): string {
  return isoOrFloating.substring(0, 10);
}

/**
 * Returns true if the given floating-civil datetime falls within [dateFrom, dateTo]
 * (inclusive, based on the date part only).
 */
function isWithinRange(floatingCivil: string, dateFrom: string, dateTo: string): boolean {
  const date = civilDatePart(floatingCivil);
  return date >= dateFrom && date <= dateTo;
}

// ─── HTML escape ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── i18n label maps ──────────────────────────────────────────────────────────

const LABELS = {
  th: {
    reportTitle: 'รายงานสุขภาพสำหรับแพทย์',
    reportDate: 'วันที่สร้างรายงาน',
    rangeLabel: 'ช่วงวันที่',
    rangeSep: '–',
    /**
     * Spec §7 MANDATED disclaimer (Thai):
     * "แอปไม่วินิจฉัย/ไม่ให้คำแนะนำทางการแพทย์"
     * Full sentence per spec preview wireframe.
     */
    disclaimer:
      'แอปไม่วินิจฉัย/ไม่ให้คำแนะนำทางการแพทย์ · เป็นบันทึกส่วนตัวเพื่อแสดงต่อแพทย์',
    profileTitle: 'ข้อมูลการตั้งครรภ์',
    edd: 'กำหนดคลอด (EDD)',
    gestationalWeek: 'อายุครรภ์',
    weekUnit: 'สัปดาห์',
    lifecycle: 'สถานะ',
    lifecyclePregnant: 'ตั้งครรภ์',
    lifecyclePostpartum: 'หลังคลอด',
    lifecycleEnded: 'สิ้นสุดการตั้งครรภ์',
    medTitle: 'ยาและการกินยา / Medication & adherence',
    medPlaceholder: 'ยังไม่มีข้อมูลในช่วงนี้ · ฟีเจอร์บันทึกยายังไม่ถูกสร้าง',
    kickTitle: 'นับลูกดิ้น / Kick-counts',
    kickDate: 'วันที่',
    kickCount: 'จำนวนครั้ง',
    kickDuration: 'เวลาที่ใช้',
    kickWeek: 'อายุครรภ์',
    kickMinutes: 'นาที',
    selfLogTitle: 'บันทึกตนเอง (น้ำหนัก/ความดัน/บวม) / Self-logs',
    selfLogPlaceholder: 'ยังไม่มีข้อมูลในช่วงนี้ · ฟีเจอร์บันทึกตนเองยังไม่ถูกสร้าง',
    apptTitle: 'นัดหมายและเช็กลิสต์ / Appointments',
    apptDate: 'วันที่',
    apptStatus: 'สถานะ',
    apptDone: 'เสร็จแล้ว',
    apptPending: 'รอดำเนินการ',
    labHiddenLine:
      'ผลแล็บ/บันทึกข้อความ: ผลถูกซ่อน (ไม่ได้ยินยอมให้รวมผลที่ละเอียดอ่อน)',
    noData: 'ไม่มีข้อมูลในช่วงนี้',
  },
  en: {
    reportTitle: 'Health Report for Doctor',
    reportDate: 'Report date',
    rangeLabel: 'Date range',
    rangeSep: '–',
    /**
     * Spec §7 MANDATED disclaimer (English):
     * "This app does not diagnose or give medical advice."
     */
    disclaimer:
      'This app does not diagnose or give medical advice. This is a personal record for sharing with your doctor.',
    profileTitle: 'Pregnancy Profile',
    edd: 'Expected Due Date (EDD)',
    gestationalWeek: 'Gestational week',
    weekUnit: 'weeks',
    lifecycle: 'Status',
    lifecyclePregnant: 'Pregnant',
    lifecyclePostpartum: 'Postpartum',
    lifecycleEnded: 'Ended',
    medTitle: 'Medication & adherence',
    medPlaceholder: 'Not tracked yet in this range · medication logging feature not yet built',
    kickTitle: 'Kick-counts',
    kickDate: 'Date',
    kickCount: 'Movements',
    kickDuration: 'Duration',
    kickWeek: 'Week',
    kickMinutes: 'min',
    selfLogTitle: 'Self-logs (weight / blood pressure / swelling)',
    selfLogPlaceholder: 'Not tracked yet in this range · self-log feature not yet built',
    apptTitle: 'Appointments & checklist',
    apptDate: 'Date',
    apptStatus: 'Status',
    apptDone: 'Done',
    apptPending: 'Pending',
    labHiddenLine:
      'Lab results / text notes: results hidden (sensitive results not consented for inclusion)',
    noData: 'No data in this range',
  },
} as const;

// ─── Section builders ─────────────────────────────────────────────────────────

function buildProfileSection(profile: ReportProfile, locale: Locale): string {
  const L = LABELS[locale];
  const lifecycleLabel =
    profile.lifecycle === 'postpartum'
      ? L.lifecyclePostpartum
      : profile.lifecycle === 'ended'
        ? L.lifecycleEnded
        : L.lifecyclePregnant;

  return `
    <section>
      <h2>${esc(L.profileTitle)}</h2>
      <table>
        <tr><td>${esc(L.lifecycle)}</td><td>${esc(lifecycleLabel)}</td></tr>
        <tr><td>${esc(L.edd)}</td><td>${esc(formatDate(profile.edd, locale))}</td></tr>
        <tr><td>${esc(L.gestationalWeek)}</td><td>${profile.gestationalWeek} ${esc(L.weekUnit)}</td></tr>
      </table>
    </section>`;
}

/**
 * Medication & adherence section (spec §3, first section, always rendered).
 *
 * DATA-SOURCE GAP: no medication-logging feature exists yet.
 * Renders a placeholder until the medication store is built.
 */
function buildMedicationSection(locale: Locale): string {
  const L = LABELS[locale];
  return `
    <section>
      <h2>${esc(L.medTitle)}</h2>
      <p class="placeholder">${esc(L.medPlaceholder)}</p>
    </section>`;
}

function buildKickSection(
  sessions: ReportKickSession[],
  dateFrom: string,
  dateTo: string,
  locale: Locale,
): string {
  const L = LABELS[locale];

  // Filter to range first, then cap to 10 most recent
  const inRange = sessions.filter((s) => isWithinRange(s.startedAt, dateFrom, dateTo));
  const recent = [...inRange]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10);

  if (recent.length === 0) {
    return `
      <section>
        <h2>${esc(L.kickTitle)}</h2>
        <p>${esc(L.noData)}</p>
      </section>`;
  }

  const rows = recent.map((s) => {
    const date = s.startedAt ? formatDateTime(s.startedAt, locale) : '';
    const durationMin =
      s.durationSeconds != null ? Math.round(s.durationSeconds / 60) : '—';
    const wk = s.gestationalWeekAtStart != null ? s.gestationalWeekAtStart : '—';
    return `<tr>
      <td>${esc(date)}</td>
      <td>${s.movementCount}</td>
      <td>${durationMin} ${esc(L.kickMinutes)}</td>
      <td>${wk}</td>
    </tr>`;
  }).join('');

  return `
    <section>
      <h2>${esc(L.kickTitle)}</h2>
      <table>
        <thead>
          <tr>
            <th>${esc(L.kickDate)}</th>
            <th>${esc(L.kickCount)}</th>
            <th>${esc(L.kickDuration)}</th>
            <th>${esc(L.kickWeek)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/**
 * Self-logs section (spec §3 — weight/BP/swelling).
 *
 * DATA-SOURCE GAP: no self-logging feature exists yet.
 * Renders a placeholder until the self-log store is built.
 */
function buildSelfLogSection(locale: Locale): string {
  const L = LABELS[locale];
  return `
    <section>
      <h2>${esc(L.selfLogTitle)}</h2>
      <p class="placeholder">${esc(L.selfLogPlaceholder)}</p>
    </section>`;
}

function buildAppointmentsSection(
  appointments: ReportAppointment[],
  dateFrom: string,
  dateTo: string,
  locale: Locale,
): string {
  const L = LABELS[locale];

  // Include appointments within range + undated (null scheduledAt) appointments
  const inRange = appointments.filter((a) => {
    if (!a.scheduledAt) return true; // undated → always include
    return isWithinRange(a.scheduledAt, dateFrom, dateTo);
  });

  if (inRange.length === 0) {
    return `
      <section>
        <h2>${esc(L.apptTitle)}</h2>
        <p>${esc(L.noData)}</p>
      </section>`;
  }

  // Sort by scheduledAt ascending; undated items last
  const sorted = [...inRange].sort((a, b) => {
    const sa = a.scheduledAt ?? '9999';
    const sb = b.scheduledAt ?? '9999';
    return sa.localeCompare(sb);
  });

  const rows = sorted.map((a) => {
    const date = a.scheduledAt ? formatDateTime(a.scheduledAt, locale) : '—';
    const status = a.done ? L.apptDone : L.apptPending;
    return `<tr>
      <td>${esc(date)}</td>
      <td>${esc(a.title)}</td>
      <td>${esc(status)}</td>
    </tr>`;
  }).join('');

  return `
    <section>
      <h2>${esc(L.apptTitle)}</h2>
      <table>
        <thead>
          <tr>
            <th>${esc(L.apptDate)}</th>
            <th>—</th>
            <th>${esc(L.apptStatus)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/**
 * Lab/notes hidden line (spec §2.2/§3).
 * When includeSensitiveNotes=false (default), renders a "results hidden" line.
 * When true, this line is omitted (notes would be included in a future implementation).
 */
function buildLabLine(includeSensitiveNotes: boolean, locale: Locale): string {
  if (includeSensitiveNotes) return '';
  const L = LABELS[locale];
  return `<p class="lab-hidden">${esc(L.labHiddenLine)}</p>`;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

/**
 * buildDoctorReportHtml — assemble the full doctor-report HTML string.
 *
 * Pure function — deterministic, no side effects.
 * Caller passes all data; this module imports nothing from stores.
 *
 * Section order (spec §3):
 *   1. Profile header
 *   2. Medication & adherence (placeholder)
 *   3. Kick-counts (date-range filtered)
 *   4. Self-logs (placeholder)
 *   5. Appointments (date-range filtered)
 *   6. Lab results hidden line (when !includeSensitiveNotes)
 *   Footer: §7 disclaimer
 *
 * Security: does NOT include tokens or credentials.
 * The output is safe to write to a temp PDF file via expo-print.
 */
export function buildDoctorReportHtml(input: DoctorReportInput): string {
  const {
    profile,
    kickSessions,
    appointments,
    dateFrom,
    dateTo,
    reportDate,
    locale,
    includeSensitiveNotes = false,
  } = input;
  const L = LABELS[locale];

  const reportDateFormatted = formatDate(reportDate, locale);
  const dateFromFormatted = formatDate(dateFrom, locale);
  const dateToFormatted = formatDate(dateTo, locale);

  const profileSection = buildProfileSection(profile, locale);
  const medSection = buildMedicationSection(locale);
  const kickSection = buildKickSection(kickSessions, dateFrom, dateTo, locale);
  const selfLogSection = buildSelfLogSection(locale);
  const apptSection = buildAppointmentsSection(appointments, dateFrom, dateTo, locale);
  const labLine = buildLabLine(includeSensitiveNotes, locale);

  return `<!DOCTYPE html>
<html lang="${locale === 'th' ? 'th' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(L.reportTitle)}</title>
  <style>
    body {
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      color: #3A2A30;
      margin: 24px;
      line-height: 1.5;
    }
    h1 { font-size: 20px; color: #A8505A; margin-bottom: 4px; }
    h2 { font-size: 16px; color: #5F4A52; border-bottom: 1px solid #EBE1D9; padding-bottom: 4px; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #EBE1D9; font-size: 13px; }
    th { background: #F5F0ED; font-weight: 600; }
    .header { margin-bottom: 16px; }
    .report-date { color: #94818A; font-size: 12px; }
    .range { color: #5F4A52; font-size: 13px; margin-top: 4px; }
    .placeholder { color: #94818A; font-size: 12px; font-style: italic; margin: 4px 0; }
    .lab-hidden { color: #94818A; font-size: 12px; border-top: 1px solid #EBE1D9; padding-top: 8px; margin-top: 16px; }
    .disclaimer { color: #94818A; font-size: 11px; border-top: 1px solid #EBE1D9; margin-top: 24px; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(L.reportTitle)}</h1>
    <p class="range">${esc(L.rangeLabel)}: ${esc(dateFromFormatted)} ${esc(L.rangeSep)} ${esc(dateToFormatted)}</p>
    <p class="report-date">${esc(L.reportDate)}: ${esc(reportDateFormatted)}</p>
  </div>

  ${profileSection}
  ${medSection}
  ${kickSection}
  ${selfLogSection}
  ${apptSection}
  ${labLine}

  <p class="disclaimer">${esc(L.disclaimer)}</p>
</body>
</html>`;
}
