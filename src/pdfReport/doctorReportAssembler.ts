/**
 * doctorReportAssembler — pure on-device doctor-report HTML builder.
 *
 * This module is the testable core of the PDF-doctor feature.
 * It is PURE: takes explicit input, returns HTML — no side effects,
 * no store imports, no native calls.
 *
 * Design:
 *   - HTML → PDF via expo-print (Print.printToFileAsync) at the caller layer.
 *   - All sections are rendered from data the app already holds locally.
 *   - On-device only; NO health data is sent to a server (PDPA PDPA-friendly).
 *   - Locale-aware: Thai (th) uses BE years + Thai month names;
 *     English (en) uses CE dates.
 *   - Capped to 10 most-recent kick sessions to keep PDF concise.
 *   - Deterministic for identical inputs (pure function).
 *
 * Report layout (spec: pdf-doctor-ui.md — derived from task prompt):
 *   1. Header (report title, date, disclaimer)
 *   2. Pregnancy profile (EDD, gestational week, lifecycle)
 *   3. Recent kick-count sessions (capped to 10)
 *   4. Appointments & reminders
 *   5. Supplies checklist
 *
 * Security:
 *   - NEVER include auth tokens, passwords, or any credential.
 *   - No sensitive data is logged (this module has no log calls).
 *   - The output HTML is written to a temp file by expo-print and
 *     only shared by explicit user action via expo-sharing.
 */

import type { Locale } from '../auth/types';
import type { ChecklistItemCategory } from '../sync/syncTypes';
import type { SupplyCategory } from '../sync/syncTypes';

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

export interface ReportReminder {
  id: string;
  displayTitle: string;
  type: string;
  active: boolean;
}

export interface ReportSupply {
  id: string;
  name: string;
  onHandQty: number;
  category: SupplyCategory;
}

export interface DoctorReportInput {
  profile: ReportProfile;
  kickSessions: ReportKickSession[];
  appointments: ReportAppointment[];
  reminders: ReportReminder[];
  supplies: ReportSupply[];
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
    reportTitle: 'สรุปข้อมูลสุขภาพสำหรับแพทย์',
    reportDate: 'วันที่สร้างรายงาน',
    disclaimer: 'รายงานนี้เป็นบันทึกส่วนตัว ไม่ใช่คำวินิจฉัยทางการแพทย์',
    profileTitle: 'ข้อมูลการตั้งครรภ์',
    edd: 'กำหนดคลอด (EDD)',
    gestationalWeek: 'อายุครรภ์',
    weekUnit: 'สัปดาห์',
    lifecycle: 'สถานะ',
    lifecyclePregnant: 'ตั้งครรภ์',
    lifecyclePostpartum: 'หลังคลอด',
    lifecycleEnded: 'สิ้นสุดการตั้งครรภ์',
    kickTitle: 'บันทึกการนับลูกดิ้น (10 ครั้งล่าสุด)',
    kickDate: 'วันที่',
    kickCount: 'จำนวนครั้ง',
    kickDuration: 'เวลาที่ใช้',
    kickWeek: 'อายุครรภ์',
    kickMinutes: 'นาที',
    apptTitle: 'นัดหมายและการแจ้งเตือน',
    apptDate: 'วันที่',
    apptStatus: 'สถานะ',
    apptDone: 'เสร็จแล้ว',
    apptPending: 'รอดำเนินการ',
    remindersTitle: 'การแจ้งเตือนที่ตั้งไว้',
    reminderType: 'ประเภท',
    reminderActive: 'เปิดใช้งาน',
    reminderInactive: 'ปิดใช้งาน',
    suppliesTitle: 'รายการเตรียมคลอด',
    supplyQty: 'จำนวนที่มี',
    noData: 'ไม่มีข้อมูล',
    yes: 'ใช่',
    no: 'ไม่ใช่',
  },
  en: {
    reportTitle: 'Health Summary for Doctor',
    reportDate: 'Report date',
    disclaimer: 'This report is a personal record. Not a substitute for medical advice.',
    profileTitle: 'Pregnancy Profile',
    edd: 'Expected Due Date (EDD)',
    gestationalWeek: 'Gestational week',
    weekUnit: 'weeks',
    lifecycle: 'Status',
    lifecyclePregnant: 'Pregnant',
    lifecyclePostpartum: 'Postpartum',
    lifecycleEnded: 'Ended',
    kickTitle: 'Kick Count Log (last 10 sessions)',
    kickDate: 'Date',
    kickCount: 'Movements',
    kickDuration: 'Duration',
    kickWeek: 'Week',
    kickMinutes: 'min',
    apptTitle: 'Appointments & Reminders',
    apptDate: 'Date',
    apptStatus: 'Status',
    apptDone: 'Done',
    apptPending: 'Pending',
    remindersTitle: 'Active Reminders',
    reminderType: 'Type',
    reminderActive: 'Active',
    reminderInactive: 'Inactive',
    suppliesTitle: 'Supply Checklist',
    supplyQty: 'Qty on hand',
    noData: 'No data',
    yes: 'Yes',
    no: 'No',
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

function buildKickSection(sessions: ReportKickSession[], locale: Locale): string {
  const L = LABELS[locale];
  // Cap to 10 most recent (sessions already sorted descending by caller, but sort here too)
  const recent = [...sessions]
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
    const date = s.startedAt
      ? formatDateTime(s.startedAt, locale)
      : '';
    const durationMin =
      s.durationSeconds != null
        ? Math.round(s.durationSeconds / 60)
        : '—';
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

function buildAppointmentsSection(
  appointments: ReportAppointment[],
  locale: Locale,
): string {
  const L = LABELS[locale];

  if (appointments.length === 0) {
    return `
      <section>
        <h2>${esc(L.apptTitle)}</h2>
        <p>${esc(L.noData)}</p>
      </section>`;
  }

  // Sort by scheduledAt ascending; undated items last
  const sorted = [...appointments].sort((a, b) => {
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

function buildRemindersSection(reminders: ReportReminder[], locale: Locale): string {
  const L = LABELS[locale];

  if (reminders.length === 0) {
    return '';
  }

  const rows = reminders.map((r) => {
    const activeLabel = r.active ? L.reminderActive : L.reminderInactive;
    return `<tr>
      <td>${esc(r.displayTitle)}</td>
      <td>${esc(r.type)}</td>
      <td>${esc(activeLabel)}</td>
    </tr>`;
  }).join('');

  return `
    <section>
      <h2>${esc(L.remindersTitle)}</h2>
      <table>
        <thead>
          <tr>
            <th>—</th>
            <th>${esc(L.reminderType)}</th>
            <th>—</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function buildSuppliesSection(supplies: ReportSupply[], locale: Locale): string {
  const L = LABELS[locale];

  if (supplies.length === 0) {
    return `
      <section>
        <h2>${esc(L.suppliesTitle)}</h2>
        <p>${esc(L.noData)}</p>
      </section>`;
  }

  const rows = supplies.map((s) => `<tr>
    <td>${esc(s.name)}</td>
    <td>${s.onHandQty}</td>
    <td>${esc(s.category)}</td>
  </tr>`).join('');

  return `
    <section>
      <h2>${esc(L.suppliesTitle)}</h2>
      <table>
        <thead>
          <tr>
            <th>—</th>
            <th>${esc(L.supplyQty)}</th>
            <th>—</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

/**
 * buildDoctorReportHtml — assemble the full doctor-report HTML string.
 *
 * Pure function — deterministic, no side effects.
 * Caller passes all data; this module imports nothing from stores.
 *
 * Security: does NOT include tokens or credentials.
 * The output is safe to write to a temp PDF file via expo-print.
 */
export function buildDoctorReportHtml(input: DoctorReportInput): string {
  const { profile, kickSessions, appointments, reminders, supplies, reportDate, locale } = input;
  const L = LABELS[locale];

  const reportDateFormatted = formatDate(reportDate, locale);

  const profileSection = buildProfileSection(profile, locale);
  const kickSection = buildKickSection(kickSessions, locale);
  const apptSection = buildAppointmentsSection(appointments, locale);
  const remindersSection = buildRemindersSection(reminders, locale);
  const suppliesSection = buildSuppliesSection(supplies, locale);

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
    .disclaimer { color: #94818A; font-size: 11px; border-top: 1px solid #EBE1D9; margin-top: 24px; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${esc(L.reportTitle)}</h1>
    <p class="report-date">${esc(L.reportDate)}: ${esc(reportDateFormatted)}</p>
  </div>

  ${profileSection}
  ${kickSection}
  ${apptSection}
  ${remindersSection}
  ${suppliesSection}

  <p class="disclaimer">${esc(L.disclaimer)}</p>
</body>
</html>`;
}
