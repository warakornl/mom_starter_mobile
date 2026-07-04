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
 *   4. Self-logs weight/BP/swelling (data-driven from selfLogSyncStore, decoded from base64)
 *   5. Appointments & checklist (date-range filtered)
 *   6. Lab/notes line — "ผลถูกซ่อน" when includeSensitiveNotes=false (spec §2.2)
 *   Footer: spec §7 mandatory disclaimer
 *
 * DATA-SOURCE GAPS (flagged for upstream):
 *   - Medication & adherence: no medication-logging feature exists in the app yet.
 *     Section renders with "ยังไม่มีข้อมูลในช่วงนี้ / not tracked yet" placeholder.
 *     Fully populating this section requires building the medication-log store first.
 *   - Self-logs (weight/BP/swelling): shipped. Caller (DoctorPdfScreen) decodes
 *     base64 values from selfLogSyncStore and passes decoded ReportSelfLog[] here.
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
import type { ChecklistItemCategory, SelfLogMetricType } from '../sync/syncTypes';
import { kickCountChartSvg } from './reportCharts';
import {
  computeAdherence,
  type ReportMedicationPlan,
  type ReportMedicationLog,
} from './medicationAdherence';

// Re-export medication types so callers (DoctorPdfScreen, tests) import from one place.
export type { ReportMedicationPlan, ReportMedicationLog } from './medicationAdherence';

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

/**
 * ReportSelfLog — a single decoded self-log for the PDF section.
 *
 * Values here are ALREADY DECODED from base64 (the caller — DoctorPdfScreen —
 * decodes them from selfLogSyncStore before passing to the assembler).
 * The assembler is pure and renders them verbatim — no interpretation, no grading.
 *
 * Field population mirrors self-log-behavior.md §1:
 *   weight         → valueNumeric (kg string), unit="kg", others null
 *   blood_pressure → valueNumeric (systolic), valueNumericSecondary (diastolic),
 *                    unit="mmHg", valueText null
 *   swelling/lochia/symptom → valueText (descriptive), others null, unit null
 *
 * Security: NEVER log any value/note field — MOTHER-health data (SD-5).
 */
export interface ReportSelfLog {
  id: string;
  /** Floating-civil "YYYY-MM-DDTHH:mm" — calendar bucket key (FLAG-1). */
  loggedAt: string;
  /** Closed enum — 5 values (self-log-behavior.md §1). */
  metricType: SelfLogMetricType;
  /** Decoded plaintext: kg for weight, systolic for blood_pressure; null otherwise. */
  valueNumeric: string | null | undefined;
  /** Decoded plaintext: diastolic for blood_pressure only; null otherwise. */
  valueNumericSecondary: string | null | undefined;
  /** Decoded plaintext: descriptive value for swelling/lochia/symptom; null otherwise. */
  valueText: string | null | undefined;
  /** Plaintext unit label: "kg" | "mmHg" | null (display metadata only). */
  unit: string | null | undefined;
  /** Decoded plaintext optional note. Gated on includeSensitiveNotes. Never parsed. */
  note: string | null | undefined;
}

export interface DoctorReportInput {
  profile: ReportProfile;
  kickSessions: ReportKickSession[];
  appointments: ReportAppointment[];
  /**
   * Decoded self-log records. Values must already be decoded from base64
   * by the caller (DoctorPdfScreen). The assembler renders verbatim — no
   * interpretation, no grading, no colour (spec §A.4, AC-20, INV-S1).
   */
  selfLogs?: ReportSelfLog[];
  /**
   * Decoded medication plan records. name/dose must already be decoded from base64
   * by the caller (DoctorPdfScreen). The assembler renders verbatim — no
   * interpretation, no grading (§A.5, AC-20, INV-M1).
   * Adherence (N/M) computed on-device via computeAdherence (RULING 7.3).
   * Security: NEVER log name or dose — SD-2/SD-5.
   */
  medicationPlans?: ReportMedicationPlan[];
  /**
   * Live medication log records. note must already be decoded from base64.
   * Gated on includeSensitiveNotes for PDF inclusion (§A.6).
   * Security: NEVER log occurrenceTime, note, or medicationPlanId — SD-5.
   */
  medicationLogs?: ReportMedicationLog[];
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

/** Format "YYYY-MM-DDTHH:mm" floating-civil datetime → localized date + time string. */
export function formatDateTime(floatingCivil: string, locale: Locale): string {
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
 * isWithinRange — returns true if the given floating-civil datetime falls within
 * [dateFrom, dateTo] (inclusive, based on the date part only).
 *
 * Exported so ReportPreview's sub-components can share the same filtering logic
 * as the assembler, preventing the preview and PDF from drifting apart.
 */
export function isWithinRange(floatingCivil: string, dateFrom: string, dateTo: string): boolean {
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

/**
 * LABELS — exported so the ReportPreview component can derive its section
 * labels, placeholder strings, and disclaimer from the same source as the PDF
 * assembler, preventing drift between the preview and the actual PDF output.
 *
 * Callers: use LABELS[locale].xxx; do not hard-code strings in the preview.
 */
export const LABELS = {
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
    /** Empty-range wording for medication section (spec §A.6). */
    medNoData: 'ไม่มีข้อมูลในช่วงนี้',
    /** Prefix for adherence count lines: "กินแล้ว N/M วัน" or "กินแล้ว N ครั้ง". */
    medTakenPrefix: 'กินแล้ว',
    /** Unit for scheduled adherence: "N/M วัน". */
    medDays: 'วัน',
    /** Unit for PRN count: "N ครั้ง". */
    medTimes: 'ครั้ง',
    /** Label for self-recorded dose section (ad-hoc + deleted-plan logs). */
    medAdHocLabel: 'ยาที่บันทึกเอง',
    /** Status labels for per-dose log rows. */
    medTakenStatus: 'กินแล้ว',
    medMissedStatus: 'ไม่ได้กิน',
    kickTitle: 'นับลูกดิ้น / Kick-counts',
    kickDate: 'วันที่',
    kickCount: 'จำนวนครั้ง',
    kickDuration: 'เวลาที่ใช้',
    kickWeek: 'อายุครรภ์',
    kickMinutes: 'นาที',
    selfLogTitle: 'บันทึกตนเอง (น้ำหนัก/ความดัน/บวม) / Self-logs',
    /** Empty-range wording (spec §A.4) — replaces old "feature not built" placeholder. */
    selfLogNoData: 'ไม่มีข้อมูลในช่วงนี้',
    /** Metric-type display labels (th) — used as row prefix. */
    selfLogWeight: 'น้ำหนัก',
    selfLogBP: 'ความดัน',
    selfLogSwelling: 'บวม',
    selfLogLochia: 'น้ำคาวปลา',
    selfLogSymptom: 'อาการ',
    /** Display unit for weight in Thai (stored unit "kg" → display "กก."). */
    selfLogUnitKg: 'กก.',
    selfLogUnitMmhg: 'mmHg',
    /**
     * Inline "results hidden" marker for swelling/lochia/symptom valueText
     * and for note when includeSensitiveNotes=false (spec §A.4 / G-5).
     * Distinct from the whole-section labHiddenLine.
     */
    selfLogValueHidden: 'ผลถูกซ่อน (ไม่ได้ยินยอมให้รวมผลที่ละเอียดอ่อน)',
    selfLogNoteLabel: 'หมายเหตุ',
    apptTitle: 'นัดหมายและเช็กลิสต์ / Appointments',
    apptDate: 'วันที่',
    apptStatus: 'สถานะ',
    apptDone: 'เสร็จแล้ว',
    apptPending: 'รอดำเนินการ',
    labHiddenLine:
      'ผลแล็บ/บันทึกข้อความ: ผลถูกซ่อน (ไม่ได้ยินยอมให้รวมผลที่ละเอียดอ่อน)',
    noData: 'ไม่มีข้อมูลในช่วงนี้',
    /** Chart summary below the bar chart: "{n} sessions · avg {avg}" */
    kickChartSessions: 'ครั้ง',
    kickChartAvg: 'เฉลี่ย',
    kickChartAvgUnit: 'ครั้ง/session',
    kickChartTitle: 'แนวโน้มการนับลูกดิ้น',
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
    /** Empty-range wording for medication section (spec §A.6). */
    medNoData: 'No data in this range',
    /** Prefix for adherence count lines: "Taken N/M days" or "Taken N times". */
    medTakenPrefix: 'Taken',
    /** Unit for scheduled adherence: "N/M days". */
    medDays: 'days',
    /** Unit for PRN count: "N times". */
    medTimes: 'times',
    /** Label for self-recorded dose section (ad-hoc + deleted-plan logs). */
    medAdHocLabel: 'Self-recorded dose',
    /** Status labels for per-dose log rows. */
    medTakenStatus: 'taken',
    medMissedStatus: 'missed',
    kickTitle: 'Kick-counts',
    kickDate: 'Date',
    kickCount: 'Movements',
    kickDuration: 'Duration',
    kickWeek: 'Week',
    kickMinutes: 'min',
    selfLogTitle: 'Self-logs (weight / blood pressure / swelling)',
    /** Empty-range wording (spec §A.4). */
    selfLogNoData: 'No data in this range',
    selfLogWeight: 'Weight',
    selfLogBP: 'Blood pressure',
    selfLogSwelling: 'Swelling',
    selfLogLochia: 'Lochia',
    selfLogSymptom: 'Symptom',
    selfLogUnitKg: 'kg',
    selfLogUnitMmhg: 'mmHg',
    selfLogValueHidden: 'results hidden (sensitive results not consented for inclusion)',
    selfLogNoteLabel: 'Note',
    apptTitle: 'Appointments & checklist',
    apptDate: 'Date',
    apptStatus: 'Status',
    apptDone: 'Done',
    apptPending: 'Pending',
    labHiddenLine:
      'Lab results / text notes: results hidden (sensitive results not consented for inclusion)',
    noData: 'No data in this range',
    /** Chart summary below the bar chart: "{n} sessions · avg {avg}" */
    kickChartSessions: 'sessions',
    kickChartAvg: 'avg',
    kickChartAvgUnit: 'movements',
    kickChartTitle: 'Kick-count trend',
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
 * Data-driven: renders real plan/log data once shipped (RULING 7.3).
 * Adherence computed on-device via computeAdherence (FLAG-4 expansion for M).
 *
 * Invariants (AC-20 / INV-M1):
 *   - "กินแล้ว N/M วัน" and "กินแล้ว N ครั้ง" are plain counts — NEVER graded,
 *     coloured, or thresholded. 3/31 and 27/31 render with identical surrounding HTML.
 *   - note is gated on includeSensitiveNotes (§A.6); when false it is omitted.
 *   - Empty range (no live plans + no logs in range) → medNoData wording, never
 *     the old "feature not built" placeholder (spec §A.6 empty-range rule).
 *
 * Security: no health-data fields are logged here (pure HTML builder).
 */
function buildMedicationSection(
  plans: ReportMedicationPlan[],
  logs: ReportMedicationLog[],
  dateFrom: string,
  dateTo: string,
  locale: Locale,
  includeSensitiveNotes: boolean,
): string {
  const L = LABELS[locale];

  const { planAdherences, selfRecordedLogs } = computeAdherence(
    plans,
    logs,
    dateFrom,
    dateTo,
  );

  // Determine whether there is any medication data to render.
  // A live plan (even with M=0, N=0) constitutes data — the plan exists.
  // Self-recorded logs in range also constitute data.
  const hasData = planAdherences.length > 0 || selfRecordedLogs.length > 0;

  if (!hasData) {
    // Empty-range wording (spec §A.6) — replaces the old "feature not built" placeholder.
    return `
    <section>
      <h2>${esc(L.medTitle)}</h2>
      <p>${esc(L.medNoData)}</p>
    </section>`;
  }

  // Filter logs in range per plan (for per-dose row rendering)
  const logsInRange = logs.filter((log) => {
    const d = log.occurrenceTime.substring(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  // ── Plan sections ──────────────────────────────────────────────────────────
  const planSections = planAdherences.map((pa) => {
    // Plan header: name + dose (verbatim, never parsed)
    const nameStr = esc(pa.name);
    const doseStr = pa.dose ? ` ${esc(pa.dose)}` : '';

    // Adherence count line — plain count, never graded (AC-20 / INV-M1)
    const adherenceLine = pa.isPrn
      ? `${esc(L.medTakenPrefix)} ${pa.N} ${esc(L.medTimes)}`
      : `${esc(L.medTakenPrefix)} ${pa.N}/${pa.M} ${esc(L.medDays)}`;

    // Per-dose logs for this plan in range (taken and missed — both neutral facts)
    const planLogsInRange = logsInRange
      .filter((log) => log.medicationPlanId === pa.planId)
      .sort((a, b) => a.occurrenceTime.localeCompare(b.occurrenceTime));

    const logRows = planLogsInRange.map((log) => {
      const dateStr = esc(formatDateTime(log.occurrenceTime, locale));
      const statusStr = esc(log.status === 'taken' ? L.medTakenStatus : L.medMissedStatus);
      const noteRow =
        includeSensitiveNotes && log.note
          ? `\n      <tr><td class="med-note-label">${esc(L.selfLogNoteLabel)}</td><td>${esc(log.note)}</td></tr>`
          : '';
      return `<tr><td>${dateStr}</td><td>${statusStr}</td></tr>${noteRow}`;
    }).join('');

    const logsTable = logRows
      ? `\n    <table><tbody>${logRows}</tbody></table>`
      : '';

    return `
    <div class="med-plan">
      <p class="med-plan-header"><strong>${nameStr}</strong>${doseStr}</p>
      <p class="med-adherence">${adherenceLine}</p>${logsTable}
    </div>`;
  }).join('');

  // ── Self-recorded doses section (ad-hoc + deleted-plan logs) ─────────────
  let selfRecordedSection = '';
  if (selfRecordedLogs.length > 0) {
    const sorted = [...selfRecordedLogs].sort((a, b) =>
      a.occurrenceTime.localeCompare(b.occurrenceTime),
    );
    const selfRows = sorted.map((log) => {
      const dateStr = esc(formatDateTime(log.occurrenceTime, locale));
      const statusStr = esc(log.status === 'taken' ? L.medTakenStatus : L.medMissedStatus);
      const noteRow =
        includeSensitiveNotes && log.note
          ? `\n      <tr><td class="med-note-label">${esc(L.selfLogNoteLabel)}</td><td>${esc(log.note)}</td></tr>`
          : '';
      return `<tr><td>${dateStr}</td><td>${statusStr}</td></tr>${noteRow}`;
    }).join('');
    selfRecordedSection = `
    <div class="med-adhoc">
      <p class="med-adhoc-label">${esc(L.medAdHocLabel)}</p>
      <table><tbody>${selfRows}</tbody></table>
    </div>`;
  }

  return `
    <section>
      <h2>${esc(L.medTitle)}</h2>${planSections}${selfRecordedSection}
    </section>`;
}

/**
 * buildKickSection — renders the kick-count section with an inline SVG bar chart.
 *
 * Chart renders date-ordered sessions (oldest left → most recent right) so the
 * trend reads naturally left-to-right. The same chart data is produced by
 * kickCountChartSvg (reportCharts.ts) used in DoctorPdfScreen's ReportPreview,
 * ensuring preview == PDF (single source of truth).
 *
 * K-5b: no valence coloring — neutral ink bars only (enforced in reportCharts.ts).
 * A compact text summary line appears below the chart for accessibility / fallback.
 *
 * CONSENT: only called after pdf_egress consent; chart receives data only on the
 * post-consent path (enforced by the caller in DoctorPdfScreen / handlePreviewTap).
 */
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
    // Empty state: render SVG with no-data message so the chart area is consistent
    const emptyChartSvg = kickCountChartSvg([], { noDataLabel: L.noData, title: L.kickChartTitle });
    return `
      <section>
        <h2>${esc(L.kickTitle)}</h2>
        ${emptyChartSvg}
      </section>`;
  }

  // Sort oldest-first for left-to-right time flow in the chart
  const chronological = [...recent].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const chartData = chronological.map((s) => ({
    date: s.startedAt.substring(0, 10),
    count: s.movementCount,
  }));

  // Build the summary caption line (total sessions · avg count)
  const totalSessions = chartData.length;
  const avgCount = Math.round(
    chartData.reduce((sum, s) => sum + s.count, 0) / totalSessions,
  );
  const captionLine =
    locale === 'th'
      ? `${totalSessions} ${L.kickChartSessions} · ${L.kickChartAvg} ${avgCount} ${L.kickChartAvgUnit}`
      : `${totalSessions} ${L.kickChartSessions} · ${L.kickChartAvg} ${avgCount} ${L.kickChartAvgUnit}`;

  const chartSvg = kickCountChartSvg(chartData, {
    noDataLabel: L.noData,
    caption: captionLine,
    title: L.kickChartTitle,
    width: 500,
    height: 220,
  });

  return `
    <section>
      <h2>${esc(L.kickTitle)}</h2>
      ${chartSvg}
      <p class="chart-summary">${esc(captionLine)}</p>
    </section>`;
}

/** Minimal shape consumed by selfLogMetricLabel — avoids the literal-type mismatch from `as const`. */
interface SelfLogLabels {
  selfLogWeight: string;
  selfLogBP: string;
  selfLogSwelling: string;
  selfLogLochia: string;
  selfLogSymptom: string;
  selfLogUnitKg: string;
  selfLogUnitMmhg: string;
  selfLogValueHidden: string;
  selfLogNoteLabel: string;
  selfLogNoData: string;
  selfLogTitle: string;
}

/**
 * Returns the display label for a metricType (locale-aware).
 */
function selfLogMetricLabel(metricType: SelfLogMetricType, L: SelfLogLabels): string {
  switch (metricType) {
    case 'weight':        return L.selfLogWeight;
    case 'blood_pressure': return L.selfLogBP;
    case 'swelling':      return L.selfLogSwelling;
    case 'lochia':        return L.selfLogLochia;
    case 'symptom':       return L.selfLogSymptom;
  }
}

/**
 * buildSelfLogSection — renders the self-log section from real data.
 *
 * Filter: only logs within [dateFrom, dateTo] via isWithinRange(loggedAt).
 * Empty range → renders the spec §A.4 empty-range wording (NOT the old placeholder).
 *
 * Always rendered (structured numeric values — spec §A.4, pdf-doctor-ui §2.1):
 *   weight         → "น้ำหนัก {value} {unit}" verbatim — no interpretation, no colour
 *   blood_pressure → "ความดัน {systolic}/{diastolic} {unit}" verbatim — BP 150/95
 *                    and 110/70 render with IDENTICAL style (AC-20 / INV-S1)
 *
 * Gated on includeSensitiveNotes (spec §A.4 / G-5):
 *   swelling/lochia/symptom (valueText): when false → label + date + hidden-line;
 *                                        when true  → label + date + value verbatim
 *   note (any metricType): when false → omitted; when true → rendered
 *
 * Security: NEVER log any value/note content (SD-5).
 */
function buildSelfLogSection(
  selfLogs: ReportSelfLog[],
  dateFrom: string,
  dateTo: string,
  locale: Locale,
  includeSensitiveNotes: boolean,
): string {
  const L = LABELS[locale];

  // Filter to range only (date part of floating-civil loggedAt)
  const inRange = selfLogs.filter((s) => isWithinRange(s.loggedAt, dateFrom, dateTo));

  if (inRange.length === 0) {
    // Empty-range: spec §A.4 wording — NOT the old "feature not built" placeholder
    return `
    <section>
      <h2>${esc(L.selfLogTitle)}</h2>
      <p>${esc(L.selfLogNoData)}</p>
    </section>`;
  }

  // Sort by loggedAt ascending so the report reads chronologically
  const sorted = [...inRange].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

  const rows = sorted.map((s) => {
    const dateStr = esc(formatDateTime(s.loggedAt, locale));
    const label = esc(selfLogMetricLabel(s.metricType, L));

    // Build the value cell content — structured vs gated (spec §A.4)
    let valueCells: string;

    if (s.metricType === 'weight') {
      // Always rendered — verbatim, no interpretation
      const displayUnit = L.selfLogUnitKg;
      const val = esc(s.valueNumeric ?? '');
      valueCells = `<td>${label} ${val} ${esc(displayUnit)}</td>`;
    } else if (s.metricType === 'blood_pressure') {
      // Always rendered — verbatim; 150/95 and 110/70 have IDENTICAL surrounding HTML (INV-S1)
      const sys = esc(s.valueNumeric ?? '');
      const dia = esc(s.valueNumericSecondary ?? '');
      const unit = esc(L.selfLogUnitMmhg);
      valueCells = `<td>${label} ${sys}/${dia} ${unit}</td>`;
    } else {
      // swelling / lochia / symptom — valueText is gated (spec §A.4 / G-5)
      if (includeSensitiveNotes) {
        const val = esc(s.valueText ?? '');
        valueCells = `<td>${label} ${val}</td>`;
      } else {
        // Render label + hidden-line; NO value (G-5: intentional, not a bug)
        valueCells = `<td>${label}</td><td class="lab-hidden">${esc(L.selfLogValueHidden)}</td>`;
      }
    }

    // Note — gated on includeSensitiveNotes (any metricType)
    const noteRow =
      includeSensitiveNotes && s.note
        ? `\n      <tr><td class="self-log-note-label">${esc(L.selfLogNoteLabel)}</td><td>${esc(s.note)}</td></tr>`
        : '';

    return `<tr><td>${dateStr}</td>${valueCells}</tr>${noteRow}`;
  }).join('');

  return `
    <section>
      <h2>${esc(L.selfLogTitle)}</h2>
      <table>
        <tbody>${rows}</tbody>
      </table>
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
 *   2. Medication & adherence (data-driven: adherence computed on-device, RULING 7.3)
 *   3. Kick-counts (date-range filtered)
 *   4. Self-logs (data-driven: weight/BP/swelling from decoded base64 values)
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
    selfLogs = [],
    medicationPlans = [],
    medicationLogs = [],
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
  const medSection = buildMedicationSection(
    medicationPlans,
    medicationLogs,
    dateFrom,
    dateTo,
    locale,
    includeSensitiveNotes,
  );
  const kickSection = buildKickSection(kickSessions, dateFrom, dateTo, locale);
  const selfLogSection = buildSelfLogSection(selfLogs, dateFrom, dateTo, locale, includeSensitiveNotes);
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
    .chart-summary { color: #94818A; font-size: 11px; margin-top: 4px; text-align: center; }
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
