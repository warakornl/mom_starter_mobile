/**
 * ancConfig.ts — constants and doctor-signed content for the ANC cadence
 * suggestion (anc_next_checkup).
 *
 * ANC_TARGET_WEEKS is an **ASSUMPTION pending clinical sign-off Z-16**.
 * Tests must use parametrized fixtures that test LOGIC, never golden-vector
 * against the specific week values. When Z-16 is signed, update this array —
 * no test logic changes needed.
 *
 * ANC_PREFILL_DATE flag (§3.3a / §2.1):
 *   - Default ON for build + UAT.
 *   - MUST be flipped OFF in production until launch-gate Z-16 passes.
 *   - The flip is a one-line change here; no rebuild required.
 *
 * INV-A5: All user-facing strings in ANC_CATALOG_COPY and ANC_LOCK_SCREEN_TITLE
 * are doctor-signed (clinical_signoff=true, verify_flag=false). They are STATIC
 * constants, never runtime-generated from user data.
 *
 * INV-A2: every string is invitation-not-command; the denylist test in
 * ancOfferable.test.ts verifies 0 hits on the full TH+EN corpus.
 */

import type { LocalizedContent } from './types';

// ─── Cadence constants ────────────────────────────────────────────────────────

/**
 * Target gestational weeks (ASSUMPTION — Z-16 pending clinical sign-off).
 * DO NOT write golden-vector tests pinned to these specific values.
 * Change this array when Z-16 is signed.
 */
export const ANC_TARGET_WEEKS: ReadonlyArray<number> = [
  12, 16, 20, 24, 28, 30, 32, 34, 36, 37, 38, 39, 40,
];

/** Weeks before the target when the offer first appears (open window). */
export const OFFER_LEAD_WEEKS = 1;

/** Look-ahead window (days) for the "already has an appointment" check. */
export const APPOINTMENT_WINDOW_DAYS = 14;

/** Clamp floor for the prefill date when the computed target date is in the past. */
export const PAST_CLAMP_DAYS = 3;

// ─── Config flag (ONE-LINE FLIP) ──────────────────────────────────────────────

/**
 * ANC_PREFILL_DATE — gates ONLY the prefill date value + label.
 *
 * ON  (build + UAT default): date field = nextANCDate, label = "วันแนะนำโดยประมาณ…"
 * OFF (production default):  date field = blank, label = "ตามที่แพทย์นัด"
 *
 * ⚠️  MUST be false in production until launch-gate Z-16
 *    (OB-GYN + lawyer co-sign cadence + copy + ribbon) passes.
 *    Flip this constant to true after Z-16 + Z-6 + Z-15 + Z-2 are signed.
 */
export const ANC_PREFILL_DATE = true; // DEFAULT ON for build + UAT

// ─── Doctor-signed content (INV-A5) ──────────────────────────────────────────

/**
 * ANC_CATALOG_COPY — all user-facing strings for the ANC cadence suggestion.
 * These are STATIC, doctor-signed (clinical_signoff=true, verify_flag=false).
 * Do NOT paraphrase or modify without re-running through the content gate.
 */
export const ANC_CATALOG_COPY: {
  title: LocalizedContent;
  reason: LocalizedContent;
  /** Card inline disclaimer (§3.4(1) — always-on, INV-A6). */
  cardDisclaimer: LocalizedContent;
  /** Form header disclaimer band (§3.4(1) form variant — INV-A6). */
  formDisclaimer: LocalizedContent;
  /** Date field label when ANC_PREFILL_DATE = ON. */
  dateLabelOn: LocalizedContent;
  /** Date field label when ANC_PREFILL_DATE = OFF. */
  dateLabelOff: LocalizedContent;
  /** Source ribbon (§3.4(3) — behind Z-16 gate). */
  sourceRibbon: LocalizedContent;
} = {
  title: {
    th: 'ถึงช่วงที่แนะนำให้นัดตรวจครรภ์ครั้งถัดไปแล้ว — อยากเพิ่มนัดไหม?',
    en: "It may be time to schedule your next prenatal check-up — would you like to add an appointment?",
  },
  reason: {
    th: 'การฝากครรภ์ตามนัดช่วยให้คุณหมอติดตามพัฒนาการของลูกและสุขภาพของคุณได้ต่อเนื่อง',
    en: 'Regular prenatal visits help your doctor monitor your baby\'s development and your health.',
  },
  cardDisclaimer: {
    th: 'นี่เป็นการเตือนทั่วไปตามช่วงอายุครรภ์ ไม่ใช่การนัดจากแพทย์ และไม่ใช่คำวินิจฉัยหรือคำแนะนำทางการแพทย์ โปรดยึดวัน–เวลาที่แพทย์หรือคลินิกของคุณนัดจริงเป็นหลัก',
    en: 'This is a general reminder based on your pregnancy weeks, not an appointment from your doctor, and not medical advice or diagnosis. Please follow the actual date and time your doctor or clinic gives you.',
  },
  formDisclaimer: {
    th: 'วันและเวลาที่กรอกไว้เป็นค่าเริ่มต้นโดยประมาณเพื่อความสะดวกเท่านั้น ยังไม่ใช่การนัดจริง โปรดปรับให้ตรงกับที่แพทย์หรือคลินิกของคุณนัด แล้วกดบันทึก — คุณแก้ไขทุกช่องหรือยกเลิกได้',
    en: 'The date and time pre-filled here are approximate convenience defaults only — not a real appointment. Please adjust them to match what your doctor or clinic has scheduled, then tap Save. You can edit any field or cancel.',
  },
  dateLabelOn: {
    th: 'วันแนะนำโดยประมาณ (ปรับให้ตรงที่แพทย์นัด)',
    en: "Suggested approximate date (adjust to your doctor's schedule)",
  },
  dateLabelOff: {
    th: 'ตามที่แพทย์นัด',
    en: "follow your doctor's schedule",
  },
  sourceRibbon: {
    th: 'อ้างอิงแนวทางฝากครรภ์ กรมอนามัย/RTCOG',
    en: 'Reference: ANC Guidelines, Dept of Health / RTCOG',
  },
};

/**
 * PDPA-A4: Generic lock-screen notification title.
 * MUST NEVER be "นัดตรวจครรภ์" or any string revealing the appointment type.
 * The real appointment title is shown only after unlock / in-app.
 */
export const ANC_LOCK_SCREEN_TITLE: LocalizedContent = {
  th: 'การแจ้งเตือน',
  en: 'Reminder',
};

/** Appointment title prefilled in the form (doctor-signed, flag-independent). */
export const ANC_APPOINTMENT_TITLE: LocalizedContent = {
  th: 'นัดตรวจครรภ์',
  en: 'Prenatal check-up',
};
