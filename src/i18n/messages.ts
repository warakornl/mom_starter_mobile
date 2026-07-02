/**
 * i18n message catalog — single source of truth for all UI strings.
 *
 * Structure:
 *   catalog.th — Thai strings (default locale)
 *   catalog.en — English translations (must match catalog.th's key shape exactly)
 *   MONTHS     — month-name arrays (12 entries each) for date formatting
 *   formatCivilDate — locale-aware civil-date formatter (no "วันที่" prefix)
 *   interpolate     — simple {key} template replacement
 *
 * Key naming convention: "<domain>.<key>" using dot-notation.
 * Template placeholders use {name} syntax: e.g. 'สัปดาห์ที่ {n}'.
 *
 * Auth string invariants (enforced by messages.test.ts and auth logic tests):
 *   - login.wrongCredentials  → NON-ENUMERATING (§E/C7): same copy for wrong email + wrong password
 *   - register strings        → no email-existence hints (§E/C7)
 *   - verify.resentConfirm   → non-enumerating regardless of email state
 *
 * Usage:
 *   import { catalog, formatCivilDate, interpolate } from '../i18n/messages';
 *   // or via useT() from LanguageContext.tsx:
 *   const { t, locale } = useT();
 *   t('home.weekDisplay', { n: 12 })  // → 'สัปดาห์ที่ 12' (th) or 'Week 12' (en)
 */

import type { Locale } from '../auth/types';

// ─── Month names ──────────────────────────────────────────────────────────────

export const MONTHS: Record<Locale, string[]> = {
  th: [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ],
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
};

// ─── Date formatter (no "วันที่" prefix) ─────────────────────────────────────

/**
 * Format a civil "YYYY-MM-DD" string for display.
 *   th → "D MMMM พ.ศ. YYYY+543"  (e.g. "29 มิถุนายน พ.ศ. 2569")
 *   en → "MMMM D, YYYY"           (e.g. "June 29, 2026")
 *
 * NOTE: this differs from thaiDate.ts/formatFullDate which prefixes "วันที่ ".
 * Use this function in screen components where the prefix is not needed.
 */
export function formatCivilDate(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (locale === 'th') {
    return `${d} ${MONTHS.th[m - 1]} พ.ศ. ${y + 543}`;
  }
  return `${MONTHS.en[m - 1]} ${d}, ${y}`;
}

// ─── Template interpolation ───────────────────────────────────────────────────

/**
 * Replace all {key} occurrences in `template` with values from `params`.
 *
 * @example
 *   interpolate('สัปดาห์ที่ {n} +{d} วัน', { n: 10, d: 3 })
 *   // → 'สัปดาห์ที่ 10 +3 วัน'
 */
export function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

/**
 * Thai catalog — authoritative copy.
 * All Thai strings MUST preserve existing auth test assertions:
 *   - login.wrongCredentials   contains 'รีเซ็ต'
 *   - login.offline            contains 'ออฟไลน์'
 *   - register strings         contain no enumeration hints
 *   - verify.title             contains 'อีเมล'
 *   - verify.resentConfirm     no enumeration hints
 */
const th = {
  // ── Auth: Login (S4) ────────────────────────────────────────────────────────
  /**
   * §E/C7 NON-ENUMERATING: same copy for wrong email AND wrong password.
   * Must contain 'รีเซ็ต' (loginScreenLogic.test.ts assertion).
   */
  'login.title': 'เข้าสู่ระบบ',
  'login.emailLabel': 'อีเมล',
  'login.passwordLabel': 'รหัสผ่าน',
  'login.submit': 'เข้าสู่ระบบ',
  'login.forgotPassword': 'ลืมรหัสผ่าน?',
  'login.createAccount': 'ยังไม่มีบัญชี? สร้างบัญชี',
  'login.wrongCredentials': 'อีเมลหรือรหัสผ่านไม่ตรงกัน · รีเซ็ตรหัสผ่านได้',
  'login.rateLimited': 'ลองอีกครั้งในอีกสักครู่',
  'login.offline': 'คุณออฟไลน์อยู่ · ต้องต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบ',
  'login.serverError': 'มีบางอย่างผิดพลาดทางฝั่งเรา · ข้อมูลของคุณปลอดภัย ลองอีกครั้ง',
  'login.emailHint': 'ตรวจสอบอีเมลอีกครั้ง',
  'login.emailPlaceholder': 'you@example.com',
  'login.showPassword': 'แสดงรหัสผ่าน',
  'login.hidePassword': 'ซ่อนรหัสผ่าน',
  'login.googleCta': 'ดำเนินการต่อด้วย Google',
  'login.comingSoon': 'เร็วๆ นี้',

  // ── Auth: Register (S2) ─────────────────────────────────────────────────────
  // NON-ENUMERATION (§E/C7): MUST NOT contain 'ใช้แล้ว', 'มีอยู่แล้ว', 'ถูกลงทะเบียน'
  'register.title': 'สร้างบัญชีของคุณ',
  'register.subtitle': 'สมุดสีชมพูของคุณ พร้อมเริ่มแล้ว',
  'register.emailLabel': 'อีเมล',
  'register.passwordLabel': 'รหัสผ่าน',
  'register.submit': 'สร้างบัญชี',
  'register.signIn': 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ',
  'register.emailPlaceholder': 'you@example.com',
  'register.emailHint': 'ตรวจสอบอีเมลอีกครั้ง',
  'register.passwordHint': 'อย่างน้อย 8 ตัวอักษร — ยิ่งยาวยิ่งดี',
  'register.passwordTooShort': 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
  'register.passwordBreached': 'รหัสผ่านนี้ไม่ปลอดภัย กรุณาลองรหัสผ่านอื่น',
  'register.rateLimited': 'ลองอีกครั้งในอีกสักครู่',
  'register.offline': 'คุณออฟไลน์อยู่ · ต้องต่ออินเทอร์เน็ตเพื่อสมัครสมาชิก',
  'register.serverError': 'มีบางอย่างผิดพลาดทางฝั่งเรา · ข้อมูลของคุณปลอดภัย ลองอีกครั้ง',
  'register.showPassword': 'แสดงรหัสผ่าน',
  'register.hidePassword': 'ซ่อนรหัสผ่าน',
  'register.disclaimer': 'เริ่มต้นนี้ไม่ใช่คำวินิจฉัยทางการแพทย์',

  // ── Auth: Verify Email (S3) ──────────────────────────────────────────────────
  // NON-ENUMERATION (§E/C7): resentConfirm MUST NOT reveal email existence
  'verify.navTitle': 'ยืนยันอีเมล',
  'verify.title': 'ตรวจอีเมลของคุณ',
  'verify.stepLabel': 'สร้างบัญชี · ขั้นที่ 2 จาก 3',
  'verify.sentToPrefix': 'เราส่งลิงก์ยืนยันไปที่',
  'verify.openLinkHint': 'เปิดลิงก์เพื่อเริ่มใช้งานสมุดของคุณ',
  'verify.spamTip': 'ไม่เห็นอีเมล? ลองเปิดโฟลเดอร์สแปม',
  'verify.resend': 'ส่งลิงก์อีกครั้ง',
  'verify.resentConfirm': 'ส่งอีกครั้งแล้ว · ตรวจโฟลเดอร์สแปมด้วยนะคะ',
  'verify.changeEmail': 'เปลี่ยนอีเมล',
  'verify.rateLimited': 'ลองอีกครั้งในอีกสักครู่',
  'verify.tokenInvalid': 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว · ขอลิงก์ใหม่ได้เลย',
  'verify.offline': 'คุณออฟไลน์อยู่',
  'verify.serverError': 'มีบางอย่างผิดพลาดทางฝั่งเรา · ลองอีกครั้ง',
  'verify.storageErrorHint': 'บันทึกเซสชันไม่สำเร็จ · กด "ส่งลิงก์อีกครั้ง" แล้วยืนยันใหม่อีกครั้ง',

  // ── Welcome (S1) ──────────────────────────────────────────────────────────────
  'welcome.tagline': 'สมุดสีชมพูของคุณ\nสำหรับทุกช่วงเวลาของการตั้งครรภ์',
  'welcome.createAccount': 'สร้างบัญชี',
  'welcome.signIn': 'เข้าสู่ระบบ',
  'welcome.disclaimer': 'แอปนี้ไม่ใช่คำวินิจฉัยทางการแพทย์',
  'welcome.createAccountA11y': 'สร้างบัญชีใหม่',
  'welcome.signInA11y': 'เข้าสู่ระบบด้วยบัญชีที่มีอยู่',

  // ── Stage labels ──────────────────────────────────────────────────────────────
  'stage.T1': 'ไตรมาส 1',
  'stage.T2': 'ไตรมาส 2',
  'stage.T3': 'ไตรมาส 3',

  // ── General ───────────────────────────────────────────────────────────────────
  'general.or': 'หรือ',
  'general.cancel': 'ยกเลิก',
  'general.retry': 'ลองอีกครั้ง',
  'general.back': 'กลับ',
  'general.done': 'เสร็จ',
  'general.clear': 'ล้าง',

  // ── Date/time picker (shared across forms) ────────────────────────────────────
  'picker.selectDate': 'เลือกวันที่',
  'picker.selectTime': 'เลือกเวลา',

  // ── Home screen (calendar-home) ───────────────────────────────────────────────
  // Template keys use {n}, {d}, {date}, {days}, {pct} placeholders.
  'home.loading': 'กำลังโหลด',
  'home.pregnancyProgress': 'ความคืบหน้าการตั้งครรภ์',
  'home.daysBeforeDue': 'วันก่อนถึงกำหนดคลอด',
  'home.overdueCard': 'ถึงกำหนดแล้ว · บันทึกการคลอดเมื่อพร้อม',
  'home.overdueSubline': 'ถึงกำหนดแล้ว · บันทึกการคลอดเมื่อพร้อม',
  'home.deliveryWindow': 'เตรียมคลอด',
  'home.birthCta': 'ลูกคลอดแล้ว ›',
  'home.birthCtaA11y': 'ลูกคลอดแล้ว — บันทึกการคลอด',
  /** template: {n} = displayedWeek */
  'home.weekDisplay': 'สัปดาห์ที่ {n}',
  /** template: {n} = displayedWeek, {d} = gestationalDay */
  'home.weekDisplayDays': 'สัปดาห์ที่ {n} +{d} วัน',
  /** template: {date} = formatted EDD, {days} = daysRemaining */
  'home.eddLine': 'กำหนดคลอด {date} (อีก {days} วัน)',
  /** template: {n} = postpartumWeek */
  'home.postpartumStage': 'หลังคลอด · สัปดาห์ที่ {n}',
  /** template: {n} = postpartumDays (week 0) */
  'home.babyAgeDays': 'ลูกน้อยอายุ {n} วัน',
  /** template: {n} = postpartumWeek (day 0 of week 1+) */
  'home.babyAgeWeeks': 'ลูกน้อยอายุ {n} สัปดาห์',
  /** template: {n} = postpartumWeek, {d} = postpartumDay */
  'home.babyAgeWeeksAndDays': 'ลูกน้อยอายุ {n} สัปดาห์ {d} วัน',
  'home.daysSinceBirth': 'วันนับตั้งแต่คลอด',
  /** template: {date} = formatted birth date */
  'home.birthDateLine': 'คลอดวันที่ {date}',
  /** template: {pct} = integer 0–100 */
  'home.progressA11y': 'ความคืบหน้า {pct}%',
  'home.pregnancyPlaceholder': 'ปฏิทินและบันทึกรายวัน — Slice ถัดไป',
  'home.postpartumPlaceholder': 'ปฏิทินหลังคลอดและบันทึกรายวัน — Slice ถัดไป',
  'home.errorHeadline': 'เปิดข้อมูลในเครื่องไม่สำเร็จ',
  'home.errorSubline': 'ข้อมูลของคุณยังอยู่ในเครื่อง',
  'home.logout': 'ออกจากระบบ',
  'home.logoutTitle': 'ออกจากระบบ',
  'home.logoutMessage': 'คุณต้องการออกจากระบบใช่ไหม?',
  'home.logoutCancel': 'ยกเลิก',
  'home.logoutConfirm': 'ออกจากระบบ',
  'home.settingsA11y': 'ตั้งค่า',
  'settings.title': 'ตั้งค่า',
  'settings.account': 'บัญชีผู้ใช้',

  // ── Profile Setup ─────────────────────────────────────────────────────────────
  'profile.navTitle': 'ตั้งกำหนดคลอด',
  'profile.headline': 'มาเริ่มจากกำหนดคลอดของคุณ',
  'profile.subline': 'เราจะจัดปฏิทินให้เหมาะกับช่วงของคุณ',
  'profile.methodPrompt': 'บอกเราแบบที่คุณรู้',
  'profile.methodDueDate': 'วันกำหนดคลอด',
  'profile.methodCurrentWeek': 'อายุครรภ์ตอนนี้',
  'profile.fieldDueDate': 'วันกำหนดคลอด',
  'profile.fieldCurrentWeek': 'อายุครรภ์ตอนนี้',
  'profile.datePlaceholder': 'เลือกวันที่',
  'profile.lmpLink': 'ไม่แน่ใจ? คำนวณจากประจำเดือนล่าสุด ›',
  'profile.lmpModalTitle': 'วันแรกของประจำเดือนครั้งสุดท้าย',
  'profile.lmpModalHint': 'กรอกในรูปแบบ YYYY-MM-DD',
  /** template: {date} = formatted estimated EDD */
  'profile.lmpEstimatePrefix': 'กำหนดคลอดโดยประมาณ: {date}',
  'profile.lmpEstimateSuffix': 'เป็นการประมาณ ปรับแก้ได้',
  'profile.dateModalTitle': 'เลือกวันกำหนดคลอด',
  'profile.dateModalHint': 'กรอกในรูปแบบ YYYY-MM-DD',
  'profile.dateModalCancel': 'ยกเลิก',
  'profile.dateModalConfirm': 'ยืนยันวันนี้',
  'profile.dateFormatAlertTitle': 'รูปแบบวันที่',
  'profile.dateFormatAlertMsg': 'กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD',
  /** template: {date} = formatted EDD */
  'profile.eddPreviewPrefix': 'กำหนดคลอด {date}',
  'profile.deliveryWindow': 'เตรียมคลอด',
  /** template: {stage} = stage label (e.g. 'ไตรมาส 1') */
  'profile.stageEchoPrefix': 'ตอนนี้คุณอยู่ {stage}',
  /** template: {n} = gestational week number */
  'profile.weekDisplay': 'สัปดาห์ที่ {n}',
  'profile.stepperDecrease': 'ลดสัปดาห์',
  'profile.stepperIncrease': 'เพิ่มสัปดาห์',
  'profile.next': 'ถัดไป',
  'profile.save': 'บันทึก',
  'profile.footnote': 'เปลี่ยนได้ทุกเมื่อในบัญชี',
  'profile.emptyHint': 'เพิ่มวันกำหนดคลอดเพื่อไปต่อ',
  'profile.lmpModalConfirm': 'ใช้ค่านี้',
  'profile.methodGroupA11y': 'วิธีกรอกข้อมูลการตั้งครรภ์',
  'profile.errorLogin': 'กรุณาเข้าสู่ระบบใหม่',
  'profile.errorConsentRequired': 'การบันทึกข้อมูลสุขภาพต้องเปิดสิทธิ "บันทึกสุขภาพในเครื่อง" ก่อน',
  'profile.errorConflict': 'มีการอัปเดตจากอุปกรณ์อื่น กรุณาลองอีกครั้ง',
  'profile.errorDateInvalid': 'ลองตรวจสอบวันที่อีกครั้ง',
  'profile.errorPreconditionFailed': 'ไม่สามารถบันทึกได้ในขณะนี้ กรุณาลองอีกครั้ง',
  'profile.errorGeneric': 'บันทึกไม่สำเร็จในขณะนี้',
  'profile.errorOffline': 'ออฟไลน์ · บันทึกไว้ในเครื่องเมื่อออนไลน์',

  // ── Supplies (เตรียมคลอด) ─────────────────────────────────────────────────────
  'supplies.navTitle': 'รายการเตรียมคลอด',
  'supplies.empty': 'ยังไม่มีรายการ · เพิ่มสิ่งของที่ต้องเตรียม',
  'supplies.add': 'เพิ่มรายการ',
  'supplies.addTitle': 'เพิ่มรายการใหม่',
  'supplies.editTitle': 'แก้ไขรายการ',
  'supplies.save': 'บันทึก',
  'supplies.delete': 'ลบ',
  'supplies.fieldName': 'ชื่อสิ่งของ',
  'supplies.namePlaceholder': 'เช่น ผ้าอ้อม',
  'supplies.fieldCategory': 'หมวดหมู่',
  'supplies.fieldUnit': 'หน่วย (ไม่บังคับ)',
  'supplies.unitPlaceholder': 'เช่น ชิ้น',
  'supplies.fieldOnHandQty': 'จำนวนที่มีอยู่',
  'supplies.fieldLowThreshold': 'แจ้งเตือนเมื่อต่ำกว่า (ไม่บังคับ)',
  'supplies.category.diapers': 'ผ้าอ้อม',
  'supplies.category.feeding': 'อุปกรณ์นม',
  'supplies.category.hygiene': 'สุขอนามัย',
  'supplies.category.health-supplies': 'อุปกรณ์สุขภาพ',
  'supplies.category.other': 'อื่นๆ',
  'supplies.syncError': 'ซิงค์ไม่สำเร็จ · ลองอีกครั้ง',
  'supplies.conflictNote': 'อัปเดตจากอุปกรณ์อื่น',
  'supplies.rejectedNote': 'บางรายการถูกปฏิเสธ',
  'supplies.loading': 'กำลังโหลด',
  'supplies.refresh': 'รีเฟรช',
  'supplies.errorNameRequired': 'กรุณาระบุชื่อสิ่งของ',
  'supplies.errorQtyInvalid': 'จำนวนต้องไม่ติดลบ',
  'supplies.deleteConfirmTitle': 'ลบรายการ',
  /** template: {name} = item name */
  'supplies.deleteConfirmMsg': 'ต้องการลบ "{name}" ใช่ไหม?',
  'supplies.deleteConfirmCancel': 'ยกเลิก',
  'supplies.deleteConfirmOk': 'ลบ',
  'supplies.shortcutBtn': 'รายการเตรียมคลอด ›',

  // ── Calendar (ปฏิทิน) ─────────────────────────────────────────────────────────
  'calendar.navTitle': 'ปฏิทิน',
  'calendar.today': 'วันนี้',
  'calendar.empty': 'ไม่มีกิจกรรมในวันนี้',
  'calendar.loading': 'กำลังโหลด',
  'calendar.offline': 'ออฟไลน์ · แสดงข้อมูลในเครื่อง',
  'calendar.viewAll': 'ดูทั้งหมด',
  'calendar.addAppointment': '+ นัดหมายใหม่',
  'calendar.addReminder': '+ เตือนความจำใหม่',
  /** template: {date} = formatted date */
  'calendar.dayHeading': '{date}',
  'calendar.status.due': 'รอดำเนินการ',
  'calendar.status.done': 'เสร็จแล้ว',
  'calendar.status.snoozed': 'เลื่อนออกไป',
  'calendar.status.missed': 'พลาด',
  'calendar.markDone': 'ทำแล้ว',
  'calendar.snooze': 'เลื่อน',
  'calendar.snooze1h': 'เลื่อน 1 ชั่วโมง',
  'calendar.snooze1d': 'เลื่อน 1 วัน',
  /** NEW Feature B — edit button label in reminder occurrence action Alert */
  'calendar.editReminder': 'แก้ไข',
  'calendar.indicator.missed': 'มีรายการที่พลาด',
  'calendar.indicator.due': 'มีรายการรอดำเนินการ',
  'calendar.indicator.done': 'ทำครบทุกรายการ',
  'calendar.syncError': 'ซิงค์ไม่สำเร็จ · ลองอีกครั้ง',

  // ── Appointments (นัดหมาย) ────────────────────────────────────────────────────
  'appointment.navTitleNew': 'นัดหมายใหม่',
  'appointment.navTitleEdit': 'แก้ไขนัดหมาย',
  'appointment.fieldTitle': 'หัวข้อนัดหมาย',
  'appointment.titlePlaceholder': 'เช่น ฝากครรภ์',
  'appointment.fieldDate': 'วันที่',
  'appointment.fieldTime': 'เวลา',
  'appointment.allDay': 'ทั้งวัน',
  'appointment.fieldLocation': 'สถานที่ (ไม่บังคับ)',
  'appointment.locationPlaceholder': 'เช่น โรงพยาบาล',
  'appointment.fieldDoctor': 'แพทย์/คลินิก (ไม่บังคับ)',
  'appointment.doctorPlaceholder': 'เช่น นพ. สมชาย',
  'appointment.fieldNote': 'บันทึกเพิ่มเติม (ไม่บังคับ)',
  'appointment.notePlaceholder': 'ข้อมูลเพิ่มเติม',
  'appointment.save': 'บันทึก',
  'appointment.delete': 'ลบนัดหมาย',
  'appointment.deleteConfirmTitle': 'ลบนัดหมาย',
  'appointment.deleteConfirmMsg': 'ต้องการลบนัดหมายนี้ใช่ไหม?',
  'appointment.deleteConfirmCancel': 'ยกเลิก',
  'appointment.deleteConfirmOk': 'ลบ',
  'appointment.errorTitleRequired': 'กรุณาระบุหัวข้อนัดหมาย',
  'appointment.errorDateRequired': 'กรุณาเลือกวันและเวลา',
  'appointment.errorDateFormat': 'รูปแบบวันที่ไม่ถูกต้อง',
  'appointment.category.appointment': 'นัดหมาย',
  'appointment.category.anc_visit': 'ฝากครรภ์',
  'appointment.category.lab_panel': 'ตรวจเลือด',
  'appointment.category.screening': 'คัดกรอง',
  'appointment.category.vaccine': 'ฉีดวัคซีน',
  'appointment.category.checklist_task': 'งานในรายการ',
  'appointment.category.postpartum_check': 'ตรวจหลังคลอด',
  'appointment.noteFormatHint': 'สถานที่และแพทย์จะถูกบันทึกในช่องบันทึก',

  // ── Reminders (เตือนความจำ) ───────────────────────────────────────────────────
  'reminder.navTitleNew': 'เตือนความจำใหม่',
  'reminder.navTitleEdit': 'แก้ไขเตือนความจำ',
  'reminder.fieldTitle': 'ชื่อการแจ้งเตือน',
  'reminder.titlePlaceholder': 'เช่น ทานยาวิตามิน',
  'reminder.fieldType': 'ประเภท',
  'reminder.fieldStartDate': 'วันที่เริ่ม',
  'reminder.fieldStartTime': 'เวลา',
  /** Renamed from "ความถี่" to "ทำซ้ำ" per design §3 / Feature A spec. */
  'reminder.fieldFreq': 'ทำซ้ำ',
  'reminder.freq.one_off': 'ครั้งเดียว',
  'reminder.freq.daily': 'ทุกวัน',
  'reminder.freq.every_n_days': 'ทุก N วัน',
  /** NEW — weekly freq chip label */
  'reminder.freq.weekly': 'เลือกวันในสัปดาห์',
  /** template: {n} = interval */
  'reminder.everyNDaysLabel': 'ทุก {n} วัน',
  'reminder.fieldInterval': 'ทุกกี่วัน',
  /** NEW — interval field label for weekly freq */
  'reminder.fieldIntervalWeeks': 'ทุกกี่สัปดาห์ (1–52)',
  /** NEW — day-of-week selector section label */
  'reminder.fieldByDay': 'เลือกวัน',
  /** NEW — day-of-week chip labels (short Thai abbreviations, Sun-first display) */
  'reminder.byDay.MO': 'จ',
  'reminder.byDay.TU': 'อ',
  'reminder.byDay.WE': 'พ',
  'reminder.byDay.TH': 'พฤ',
  'reminder.byDay.FR': 'ศ',
  'reminder.byDay.SA': 'ส',
  'reminder.byDay.SU': 'อา',
  /** NEW — validation error when byDay is empty for weekly */
  'reminder.errorByDayRequired': 'กรุณาเลือกอย่างน้อย 1 วัน',
  'reminder.fieldTimesOfDay': 'เวลาที่แจ้งเตือน',
  'reminder.addTime': '+ เพิ่มเวลา',
  'reminder.fieldUntil': 'ถึงวันที่ (ไม่บังคับ)',
  'reminder.untilPlaceholder': 'วันสุดท้าย (ไม่บังคับ)',
  'reminder.fieldActive': 'เปิดใช้งาน',
  'reminder.save': 'บันทึก',
  'reminder.delete': 'ลบเตือนความจำ',
  'reminder.deleteConfirmTitle': 'ลบเตือนความจำ',
  'reminder.deleteConfirmMsg': 'ต้องการลบเตือนความจำนี้ใช่ไหม?',
  'reminder.deleteConfirmCancel': 'ยกเลิก',
  'reminder.deleteConfirmOk': 'ลบ',
  'reminder.errorTitleRequired': 'กรุณาระบุชื่อการแจ้งเตือน',
  'reminder.errorStartRequired': 'กรุณาเลือกวันและเวลาเริ่ม',
  'reminder.errorTimesRequired': 'กรุณาเพิ่มเวลาอย่างน้อย 1 เวลา',
  'reminder.errorIntervalInvalid': 'ระยะห่างต้องมากกว่า 0',
  'reminder.type.medication': 'ยา',
  'reminder.type.kick_count': 'นับลูกดิ้น',
  'reminder.type.feeding': 'ให้นม',
  'reminder.type.appointment': 'นัดหมาย',
  'reminder.type.supply_restock': 'เติมของ',
  'reminder.type.custom': 'อื่นๆ',
  'reminder.notificationCarryForward': 'การแจ้งเตือนระดับ OS จะเพิ่มในเวอร์ชันถัดไป',

  // ── Birth Event ───────────────────────────────────────────────────────────────
  'birth.navTitle': 'ลูกคลอดแล้ว',
  'birth.headline': 'ยินดีด้วยนะคะ',
  'birth.subline': 'มาบันทึกการคลอดของคุณกัน',
  'birth.fieldBirthDate': 'วันที่คลอด',
  'birth.datePlaceholder': 'เลือกวันที่',
  'birth.fieldDeliveryType': 'วิธีคลอด (ไม่บังคับ)',
  'birth.fieldNote': 'บันทึกเพิ่มเติม (ไม่บังคับ)',
  'birth.notePlaceholder': 'เพิ่มบันทึกสั้น ๆ ถ้าต้องการ',
  'birth.encryptionNote': '🔒 เก็บแบบเข้ารหัสในเครื่องและบนคลาวด์',
  'birth.consequence': 'สิ่งนี้จะปิดไทม์ไลน์การตั้งครรภ์ และเริ่มช่วงหลังคลอด บันทึกทั้งหมดของคุณยังอยู่ครบ',
  'birth.save': 'บันทึกการคลอด',
  'birth.emptyHint': 'เพิ่มวันที่คลอดเพื่อบันทึก',
  'birth.dateModalTitle': 'เลือกวันที่คลอด',
  'birth.dateModalHint': 'กรอกในรูปแบบ YYYY-MM-DD เช่น 2026-06-29',
  'birth.dateModalCancel': 'ยกเลิก',
  'birth.dateModalConfirm': 'ยืนยัน',
  'birth.dateFormatAlertTitle': 'รูปแบบวันที่',
  'birth.dateFormatAlertMsg': 'กรุณากรอกวันที่ในรูปแบบ YYYY-MM-DD เช่น 2026-06-29',
  'birth.futureDateTitle': 'ตรวจสอบวันที่',
  'birth.futureDateMessage': 'วันคลอดดูเหมือนจะเป็นอนาคต — ต้องการใช้วันนี้ไหมคะ?',
  'birth.futureDateCancel': 'ยกเลิก',
  'birth.futureDateContinue': 'ใช้ต่อ',
  'birth.errorLogin': 'กรุณาเข้าสู่ระบบใหม่',
  'birth.errorConsentRequired': 'การบันทึกต้องเปิดสิทธิ "บันทึกสุขภาพในเครื่อง" ก่อน',
  'birth.errorConflict': 'มีการบันทึกจากอุปกรณ์อื่น กรุณาดูข้อมูลล่าสุดในหน้าหลัก',
  'birth.errorDateInvalid': 'ลองตรวจสอบวันที่อีกครั้ง (วันที่ไม่ถูกต้อง)',
  'birth.errorPreconditionFailed': 'ไม่สามารถบันทึกได้ กรุณาลองอีกครั้ง',
  'birth.errorNotFound': 'ไม่พบข้อมูลการตั้งครรภ์',
  'birth.errorGeneric': 'บันทึกไม่สำเร็จในขณะนี้',
  'birth.errorOffline': 'ออฟไลน์ · บันทึกไว้ในเครื่องเมื่อออนไลน์',
  'birth.delivery.vaginal': 'คลอดเอง',
  'birth.delivery.cesarean': 'ผ่าคลอด',
  'birth.delivery.other': 'อื่น ๆ',
  'birth.delivery.prefer_not': 'ไม่ระบุ',

  // ── Kick Count (นับลูกดิ้น) ───────────────────────────────────────────────────
  // K-5b: render count=3 and count=10 identically (only the number differs).
  // K-5d: safety strip MUST use generic text — no number "10", no time window.
  // INV-K2: no verdict/valence strings (no "เก่งมาก!", no "ครบแล้ว!").
  // SR labels (§5.2): "นับได้ N ครั้ง" — ห้ามใช้ "เป้าหมาย"/"goal"/"target"
  'kick.navTitle': 'นับลูกดิ้น',
  'kick.historyNavTitle': 'ประวัตินับลูกดิ้น',
  'kick.detailNavTitle': 'รายละเอียด',
  /** template: {n} = gestational week number */
  'kick.weekLabel': 'สัปดาห์ที่ {n}',
  'kick.startBtn': 'เริ่มนับ',
  'kick.viewHistory': 'ดูประวัติทั้งหมด',
  /** K-5d generic — no "10" or time window */
  'kick.safetyStrip': 'ถ้ารู้สึกว่าลูกดิ้นน้อยลงหรือต่างจากปกติของคุณ ให้ติดต่อแพทย์ หรือไปโรงพยาบาล',
  'kick.safetySource': 'ที่มา: กรมอนามัย',
  'kick.disclaimer': 'บันทึกส่วนตัว ไม่ใช่การประเมินทางการแพทย์',
  // SC-K1 counting
  'kick.timeElapsed': 'เวลาที่ใช้',
  'kick.tapLabel': 'แตะเมื่อรู้สึกดิ้น',
  'kick.tapSublabel': 'กดทุกครั้งที่รู้สึกลูกดิ้น',
  'kick.undoBtn': '−1  แก้การนับล่าสุด',
  'kick.endSessionBtn': 'จบเซสชัน',
  'kick.cancelBtn': 'ยกเลิก',
  /** K-5b: SR label — "นับได้ N ครั้ง" no "/10" no "goal" */
  /** template: {n} = current count */
  'kick.progressA11y': 'นับได้ {n} ครั้ง',
  /** template: {n} = current count */
  'kick.tapA11y': 'แตะเมื่อรู้สึกดิ้น ตอนนี้นับได้ {n} ครั้งแล้ว',
  'kick.endSessionA11y': 'จบเซสชัน บันทึกการนับครั้งนี้',
  'kick.cancelA11y': 'ยกเลิก ทิ้งการนับครั้งนี้',
  'kick.undoA11y': 'แก้การนับล่าสุด ลบ 1 ครั้ง',
  /** template: {time} = elapsed time string, {n} = count */
  'kick.timerA11y': 'เวลาที่ใช้ {time}',
  // Leave guard (SC-K1-LG)
  'kick.leaveGuardTitle': 'หยุดนับและออกจากหน้านี้ไหม?',
  /** template: {n} = count, {time} = elapsed display */
  'kick.leaveGuardBody': 'คุณนับได้ {n} ครั้ง ใช้เวลา {time}',
  'kick.leaveGuardSave': 'จบเซสชันและบันทึก',
  'kick.leaveGuardContinue': 'นับต่อ',
  'kick.leaveGuardDiscard': 'ยกเลิกและทิ้งข้อมูล',
  // Save error
  'kick.saveError': 'บันทึกไม่สำเร็จ · ลองใหม่',
  // SC-K2 draft resume
  'kick.draftSheetTitle': 'มีการนับที่ค้างอยู่',
  /** template: {date} = formatted start date, {time} = HH:MM */
  'kick.draftStartedAt': 'เริ่มเมื่อ {date} {time}',
  /** template: {n} = count, {min} = minutes */
  'kick.draftSummary': 'นับได้ {n} ครั้ง · ใช้เวลาไปแล้ว {min} นาที',
  'kick.draftResume': 'นับต่อจากที่ค้างไว้',
  'kick.draftFinalize': 'จบเซสชันและบันทึก',
  'kick.draftDiscard': 'ยกเลิกและทิ้งข้อมูลนี้',
  // SC-K3 summary (K-5b: "7 ครั้ง" not "7/10", no verdict copy)
  'kick.summaryTitle': 'บันทึกแล้ว',
  'kick.summaryHeadline': 'นับลูกดิ้น',
  'kick.summaryCountLabel': 'นับได้',
  'kick.summaryDurationLabel': 'เวลาที่ใช้',
  /** template: {n} = count — no verdict copy, no "เก่งมาก!" */
  'kick.summaryCount': '{n} ครั้ง',
  /** template: {min} = minutes */
  'kick.summaryDuration': '{min} นาที',
  'kick.summaryViewHistory': 'ดูในปฏิทิน',
  'kick.summaryDone': 'เสร็จ',
  // SC-K4 history
  'kick.historyEmpty': 'ยังไม่มีบันทึกการนับ',
  'kick.historyEmptyBody': 'กดปุ่ม "เริ่มนับ" ด้านล่างเพื่อเริ่มบันทึก',
  /** template: {n} = count, {min} = minutes, {wk} = gest week */
  'kick.historyRowA11y': '{time} นับได้ {n} ครั้ง ใช้เวลา {min} นาที สัปดาห์ที่ {wk} กดเพื่อดูรายละเอียด',
  /** K-5c: all rows must show identical tokens, only numbers differ */
  /** template: {n} = count */
  'kick.rowCount': '{n} ครั้ง',
  /** template: {min} = minutes */
  'kick.rowDuration': '{min} นาที',
  // Offline pill
  'kick.offlinePill': 'ออฟไลน์ · บันทึกไว้ในเครื่องแล้ว',
  // Consent gate
  'kick.consentGateCaption': 'ต้องให้ความยินยอมก่อนเริ่มบันทึก',
  // Store error
  'kick.storeError': 'เปิดข้อมูลในเครื่องไม่สำเร็จ',
  // SC-K6b postpartum read-only
  'kick.postpartumBanner': 'บันทึกระหว่างตั้งครรภ์ · ดูได้แบบอ่านอย่างเดียว',
  // SC-K5 detail
  'kick.detailCountLabel': 'นับได้',
  'kick.detailDurationLabel': 'เวลาที่ใช้',
  'kick.detailWeekLabel': 'อายุครรภ์',
  'kick.detailNoteLabel': 'บันทึกของฉัน',
  'kick.detailExportPdf': 'ส่งออกเป็น PDF หมอ',
  /** template: {n} = week */
  'kick.detailWeekValue': 'สัปดาห์ {n}',
};

// ─── English catalog (must match th shape exactly) ────────────────────────────

type MsgShape = typeof th;

/**
 * English translations.
 * Tone: warm, encouraging — mirrors the Thai copy's warmth.
 * NON-ENUMERATION invariants preserved (see Thai catalog comments).
 */
const en: MsgShape = {
  // ── Auth: Login ──────────────────────────────────────────────────────────────
  'login.title': 'Sign in',
  'login.emailLabel': 'Email',
  'login.passwordLabel': 'Password',
  'login.submit': 'Sign in',
  'login.forgotPassword': 'Forgot password?',
  'login.createAccount': "Don't have an account? Create one",
  /**
   * §E/C7 NON-ENUMERATING: must contain 'reset', must NOT say
   * "not found", "no account", or "doesn't exist".
   */
  'login.wrongCredentials':
    "That email and password don't match. You can reset your password.",
  'login.rateLimited': "Let's try again in a moment.",
  'login.offline': "You're offline — you'll need a connection to sign in.",
  'login.serverError':
    'Something went wrong on our end. Your details are safe — try again.',
  'login.emailHint': 'Double-check this email',
  'login.emailPlaceholder': 'you@example.com',
  'login.showPassword': 'Show password',
  'login.hidePassword': 'Hide password',
  'login.googleCta': 'Continue with Google',
  'login.comingSoon': 'Coming soon',

  // ── Auth: Register ───────────────────────────────────────────────────────────
  // NON-ENUMERATION: must NOT contain 'already registered', 'already taken',
  // 'already in use', 'email exists'
  'register.title': 'Create your account',
  'register.subtitle': 'Your pink handbook, ready to start.',
  'register.emailLabel': 'Email',
  'register.passwordLabel': 'Password',
  'register.submit': 'Create account',
  'register.signIn': 'Already have an account? Sign in',
  'register.emailPlaceholder': 'you@example.com',
  'register.emailHint': 'Double-check this email',
  'register.passwordHint': 'At least 8 characters — longer is better.',
  'register.passwordTooShort': 'Password must be at least 8 characters.',
  'register.passwordBreached':
    'This password has appeared in a data breach — please choose another.',
  'register.rateLimited': "Let's try again in a moment.",
  'register.offline': "You're offline — you'll need a connection to sign up.",
  'register.serverError':
    'Something went wrong on our end. Your details are safe — try again.',
  'register.showPassword': 'Show password',
  'register.hidePassword': 'Hide password',
  'register.disclaimer': 'This is not a substitute for medical advice.',

  // ── Auth: Verify Email ───────────────────────────────────────────────────────
  'verify.navTitle': 'Verify email',
  'verify.title': 'Check your inbox',
  'verify.stepLabel': 'Create account · Step 2 of 3',
  'verify.sentToPrefix': "We've sent a verification link to",
  'verify.openLinkHint': 'Open the link to start using your handbook.',
  'verify.spamTip': "Don't see it? Check spam or junk.",
  'verify.resend': 'Resend link',
  'verify.resentConfirm': "Sent! Check your spam folder too.",
  'verify.changeEmail': 'Change email',
  'verify.rateLimited': "Let's try again in a moment.",
  'verify.tokenInvalid':
    'This link has expired or already been used — request a new one.',
  'verify.offline': "You're offline",
  'verify.serverError': "Something went wrong on our end — try again.",
  'verify.storageErrorHint':
    'Could not save your session — tap "Resend link" and verify again.',

  // ── Welcome ──────────────────────────────────────────────────────────────────
  'welcome.tagline':
    'Your pink handbook\nfor every moment of your pregnancy',
  'welcome.createAccount': 'Create account',
  'welcome.signIn': 'Sign in',
  'welcome.disclaimer': 'This app is not a substitute for medical advice.',
  'welcome.createAccountA11y': 'Create a new account',
  'welcome.signInA11y': 'Sign in with an existing account',

  // ── Stage labels ─────────────────────────────────────────────────────────────
  'stage.T1': 'Trimester 1',
  'stage.T2': 'Trimester 2',
  'stage.T3': 'Trimester 3',

  // ── General ──────────────────────────────────────────────────────────────────
  'general.or': 'or',
  'general.cancel': 'Cancel',
  'general.retry': 'Try again',
  'general.back': 'Back',
  'general.done': 'Done',
  'general.clear': 'Clear',

  // ── Date/time picker (shared across forms) ────────────────────────────────────
  'picker.selectDate': 'Select date',
  'picker.selectTime': 'Select time',

  // ── Home screen ──────────────────────────────────────────────────────────────
  'home.loading': 'Loading',
  'home.pregnancyProgress': 'Pregnancy progress',
  'home.daysBeforeDue': 'days until due date',
  'home.overdueCard': 'Past your due date — record the birth when ready',
  'home.overdueSubline': 'Past due date — record birth when ready',
  'home.deliveryWindow': 'Preparing for birth',
  'home.birthCta': 'Baby is here ›',
  'home.birthCtaA11y': 'Baby is here — record the birth',
  'home.weekDisplay': 'Week {n}',
  'home.weekDisplayDays': 'Week {n} +{d} days',
  'home.eddLine': 'Due {date} ({days} days away)',
  'home.postpartumStage': 'Postpartum · Week {n}',
  'home.babyAgeDays': 'Baby is {n} days old',
  'home.babyAgeWeeks': 'Baby is {n} weeks old',
  'home.babyAgeWeeksAndDays': 'Baby is {n} weeks {d} days old',
  'home.daysSinceBirth': 'days since birth',
  'home.birthDateLine': 'Born {date}',
  'home.progressA11y': 'Progress {pct}%',
  'home.pregnancyPlaceholder': 'Calendar and daily log — coming soon',
  'home.postpartumPlaceholder': 'Postpartum calendar and daily log — coming soon',
  'home.errorHeadline': 'Could not load your data',
  'home.errorSubline': 'Your data is still on this device',
  'home.logout': 'Sign out',
  'home.logoutTitle': 'Sign out',
  'home.logoutMessage': 'Are you sure you want to sign out?',
  'home.logoutCancel': 'Cancel',
  'home.logoutConfirm': 'Sign out',
  'home.settingsA11y': 'Settings',
  'settings.title': 'Settings',
  'settings.account': 'Account',

  // ── Profile Setup ─────────────────────────────────────────────────────────────
  'profile.navTitle': 'Set due date',
  'profile.headline': "Let's start with your due date",
  'profile.subline': "We'll set up your calendar to match your stage",
  'profile.methodPrompt': 'Tell us what you know',
  'profile.methodDueDate': 'Due date',
  'profile.methodCurrentWeek': 'Current week',
  'profile.fieldDueDate': 'Due date',
  'profile.fieldCurrentWeek': 'Current week',
  'profile.datePlaceholder': 'Select date',
  'profile.lmpLink': 'Not sure? Calculate from last period ›',
  'profile.lmpModalTitle': 'First day of last period',
  'profile.lmpModalHint': 'Enter in YYYY-MM-DD format',
  'profile.lmpEstimatePrefix': 'Estimated due date: {date}',
  'profile.lmpEstimateSuffix': 'This is an estimate — you can adjust it',
  'profile.dateModalTitle': 'Choose due date',
  'profile.dateModalHint': 'Enter in YYYY-MM-DD format',
  'profile.dateModalCancel': 'Cancel',
  'profile.dateModalConfirm': 'Confirm',
  'profile.dateFormatAlertTitle': 'Date format',
  'profile.dateFormatAlertMsg': 'Please enter the date in YYYY-MM-DD format',
  'profile.eddPreviewPrefix': 'Due {date}',
  'profile.deliveryWindow': 'Preparing for birth',
  'profile.stageEchoPrefix': 'You are in {stage}',
  'profile.weekDisplay': 'Week {n}',
  'profile.stepperDecrease': 'Decrease week',
  'profile.stepperIncrease': 'Increase week',
  'profile.next': 'Next',
  'profile.save': 'Save',
  'profile.footnote': 'You can change this anytime in your account',
  'profile.emptyHint': 'Add a due date to continue',
  'profile.lmpModalConfirm': 'Use this',
  'profile.methodGroupA11y': 'Pregnancy input method',
  'profile.errorLogin': 'Please sign in again',
  'profile.errorConsentRequired':
    'Please enable "Record health on device" permission first',
  'profile.errorConflict':
    'Another device updated your profile — please try again',
  'profile.errorDateInvalid': 'Please double-check the date',
  'profile.errorPreconditionFailed': 'Could not save right now — please try again',
  'profile.errorGeneric': 'Could not save right now',
  'profile.errorOffline': 'Offline — will sync when back online',

  // ── Supplies ──────────────────────────────────────────────────────────────────
  'supplies.navTitle': 'Supply checklist',
  'supplies.empty': 'No items yet — add supplies to prepare',
  'supplies.add': 'Add item',
  'supplies.addTitle': 'New supply item',
  'supplies.editTitle': 'Edit item',
  'supplies.save': 'Save',
  'supplies.delete': 'Delete',
  'supplies.fieldName': 'Item name',
  'supplies.namePlaceholder': 'e.g. Diapers',
  'supplies.fieldCategory': 'Category',
  'supplies.fieldUnit': 'Unit (optional)',
  'supplies.unitPlaceholder': 'e.g. pcs',
  'supplies.fieldOnHandQty': 'Qty on hand',
  'supplies.fieldLowThreshold': 'Alert below (optional)',
  'supplies.category.diapers': 'Diapers',
  'supplies.category.feeding': 'Feeding',
  'supplies.category.hygiene': 'Hygiene',
  'supplies.category.health-supplies': 'Health supplies',
  'supplies.category.other': 'Other',
  'supplies.syncError': 'Sync failed — try again',
  'supplies.conflictNote': 'Updated from another device',
  'supplies.rejectedNote': 'Some items were rejected',
  'supplies.loading': 'Loading',
  'supplies.refresh': 'Refresh',
  'supplies.errorNameRequired': 'Please enter an item name',
  'supplies.errorQtyInvalid': 'Quantity cannot be negative',
  'supplies.deleteConfirmTitle': 'Delete item',
  'supplies.deleteConfirmMsg': 'Delete "{name}"?',
  'supplies.deleteConfirmCancel': 'Cancel',
  'supplies.deleteConfirmOk': 'Delete',
  'supplies.shortcutBtn': 'Supply checklist ›',

  // ── Calendar ──────────────────────────────────────────────────────────────────
  'calendar.navTitle': 'Calendar',
  'calendar.today': 'Today',
  'calendar.empty': 'Nothing scheduled today',
  'calendar.loading': 'Loading',
  'calendar.offline': 'Offline · showing local data',
  'calendar.viewAll': 'View all',
  'calendar.addAppointment': '+ New appointment',
  'calendar.addReminder': '+ New reminder',
  'calendar.dayHeading': '{date}',
  'calendar.status.due': 'Pending',
  'calendar.status.done': 'Done',
  'calendar.status.snoozed': 'Snoozed',
  'calendar.status.missed': 'Missed',
  'calendar.markDone': 'Done',
  'calendar.snooze': 'Snooze',
  'calendar.snooze1h': 'Snooze 1 hour',
  'calendar.snooze1d': 'Snooze 1 day',
  'calendar.editReminder': 'Edit',
  'calendar.indicator.missed': 'Has missed items',
  'calendar.indicator.due': 'Has pending items',
  'calendar.indicator.done': 'All done',
  'calendar.syncError': 'Sync failed — try again',

  // ── Appointments ──────────────────────────────────────────────────────────────
  'appointment.navTitleNew': 'New appointment',
  'appointment.navTitleEdit': 'Edit appointment',
  'appointment.fieldTitle': 'Title',
  'appointment.titlePlaceholder': 'e.g. ANC check-up',
  'appointment.fieldDate': 'Date',
  'appointment.fieldTime': 'Time',
  'appointment.allDay': 'All day',
  'appointment.fieldLocation': 'Location (optional)',
  'appointment.locationPlaceholder': 'e.g. Hospital',
  'appointment.fieldDoctor': 'Doctor / Clinic (optional)',
  'appointment.doctorPlaceholder': 'e.g. Dr. Smith',
  'appointment.fieldNote': 'Note (optional)',
  'appointment.notePlaceholder': 'Additional details',
  'appointment.save': 'Save',
  'appointment.delete': 'Delete appointment',
  'appointment.deleteConfirmTitle': 'Delete appointment',
  'appointment.deleteConfirmMsg': 'Delete this appointment?',
  'appointment.deleteConfirmCancel': 'Cancel',
  'appointment.deleteConfirmOk': 'Delete',
  'appointment.errorTitleRequired': 'Please add a title',
  'appointment.errorDateRequired': 'Please select a date and time',
  'appointment.errorDateFormat': 'Invalid date format',
  'appointment.category.appointment': 'Appointment',
  'appointment.category.anc_visit': 'ANC visit',
  'appointment.category.lab_panel': 'Lab test',
  'appointment.category.screening': 'Screening',
  'appointment.category.vaccine': 'Vaccine',
  'appointment.category.checklist_task': 'Checklist task',
  'appointment.category.postpartum_check': 'Postpartum check',
  'appointment.noteFormatHint': 'Location and doctor will be saved in the note field',

  // ── Reminders ─────────────────────────────────────────────────────────────────
  'reminder.navTitleNew': 'New reminder',
  'reminder.navTitleEdit': 'Edit reminder',
  'reminder.fieldTitle': 'Reminder name',
  'reminder.titlePlaceholder': 'e.g. Take prenatal vitamins',
  'reminder.fieldType': 'Type',
  'reminder.fieldStartDate': 'Start date',
  'reminder.fieldStartTime': 'Time',
  'reminder.fieldFreq': 'Repeat',
  'reminder.freq.one_off': 'Once',
  'reminder.freq.daily': 'Daily',
  'reminder.freq.every_n_days': 'Every N days',
  'reminder.freq.weekly': 'Select days of week',
  'reminder.everyNDaysLabel': 'Every {n} days',
  'reminder.fieldInterval': 'Every how many days',
  'reminder.fieldIntervalWeeks': 'Every how many weeks (1–52)',
  'reminder.fieldByDay': 'Select days',
  'reminder.byDay.MO': 'Mon',
  'reminder.byDay.TU': 'Tue',
  'reminder.byDay.WE': 'Wed',
  'reminder.byDay.TH': 'Thu',
  'reminder.byDay.FR': 'Fri',
  'reminder.byDay.SA': 'Sat',
  'reminder.byDay.SU': 'Sun',
  'reminder.errorByDayRequired': 'Please select at least one day',
  'reminder.fieldTimesOfDay': 'Alert times',
  'reminder.addTime': '+ Add time',
  'reminder.fieldUntil': 'Until (optional)',
  'reminder.untilPlaceholder': 'End date (optional)',
  'reminder.fieldActive': 'Active',
  'reminder.save': 'Save',
  'reminder.delete': 'Delete reminder',
  'reminder.deleteConfirmTitle': 'Delete reminder',
  'reminder.deleteConfirmMsg': 'Delete this reminder?',
  'reminder.deleteConfirmCancel': 'Cancel',
  'reminder.deleteConfirmOk': 'Delete',
  'reminder.errorTitleRequired': 'Please add a name',
  'reminder.errorStartRequired': 'Please select a start date and time',
  'reminder.errorTimesRequired': 'Please add at least one alert time',
  'reminder.errorIntervalInvalid': 'Interval must be at least 1',
  'reminder.type.medication': 'Medication',
  'reminder.type.kick_count': 'Kick count',
  'reminder.type.feeding': 'Feeding',
  'reminder.type.appointment': 'Appointment',
  'reminder.type.supply_restock': 'Restock supply',
  'reminder.type.custom': 'Custom',
  'reminder.notificationCarryForward': 'OS-level notification firing coming in a future update',

  // ── Birth Event ───────────────────────────────────────────────────────────────
  'birth.navTitle': 'Record birth',
  'birth.headline': 'Congratulations!',
  'birth.subline': "Let's record your birth",
  'birth.fieldBirthDate': 'Birth date',
  'birth.datePlaceholder': 'Select date',
  'birth.fieldDeliveryType': 'Delivery type (optional)',
  'birth.fieldNote': 'Note (optional)',
  'birth.notePlaceholder': 'Add a short note if you like',
  'birth.encryptionNote': '🔒 Stored encrypted on device and cloud',
  'birth.consequence':
    'This will close your pregnancy timeline and begin the postpartum period. All your notes are kept.',
  'birth.save': 'Save birth',
  'birth.emptyHint': 'Add a birth date to save',
  'birth.dateModalTitle': 'Choose birth date',
  'birth.dateModalHint': 'Enter in YYYY-MM-DD format, e.g. 2026-06-29',
  'birth.dateModalCancel': 'Cancel',
  'birth.dateModalConfirm': 'Confirm',
  'birth.dateFormatAlertTitle': 'Date format',
  'birth.dateFormatAlertMsg':
    'Please enter the date in YYYY-MM-DD format, e.g. 2026-06-29',
  'birth.futureDateTitle': 'Check date',
  'birth.futureDateMessage':
    "The birth date looks like it's in the future — would you like to continue?",
  'birth.futureDateCancel': 'Cancel',
  'birth.futureDateContinue': 'Continue',
  'birth.errorLogin': 'Please sign in again',
  'birth.errorConsentRequired':
    'Please enable "Record health on device" permission first',
  'birth.errorConflict':
    'Another device recorded the birth — check your home screen for the latest',
  'birth.errorDateInvalid': 'Please double-check the date',
  'birth.errorPreconditionFailed': 'Could not save — please try again',
  'birth.errorNotFound': 'Pregnancy profile not found',
  'birth.errorGeneric': 'Could not save right now',
  'birth.errorOffline': 'Offline — will sync when back online',
  'birth.delivery.vaginal': 'Vaginal birth',
  'birth.delivery.cesarean': 'Cesarean',
  'birth.delivery.other': 'Other',
  'birth.delivery.prefer_not': 'Prefer not to say',

  // ── Kick Count ────────────────────────────────────────────────────────────────
  // K-5b: render count=3 and count=10 identically — only the number differs.
  // K-5d: safety strip MUST use generic text — no number "10", no time window.
  // SR labels: "N movements recorded" — no "goal"/"target" wording.
  'kick.navTitle': 'Kick Count',
  'kick.historyNavTitle': 'Kick Count History',
  'kick.detailNavTitle': 'Session Detail',
  'kick.weekLabel': 'Week {n}',
  'kick.startBtn': 'Start Counting',
  'kick.viewHistory': 'View all history',
  'kick.safetyStrip': "If you feel your baby's movements have decreased or changed from what is normal for you, contact your doctor or go to the hospital.",
  'kick.safetySource': 'Source: Dept. of Health',
  'kick.disclaimer': 'A personal record, not a medical assessment.',
  'kick.timeElapsed': 'Time elapsed',
  'kick.tapLabel': 'Tap when you feel a movement',
  'kick.tapSublabel': 'Tap every time you feel baby move',
  'kick.undoBtn': '−1  Undo last count',
  'kick.endSessionBtn': 'End Session',
  'kick.cancelBtn': 'Cancel',
  'kick.progressA11y': '{n} movements recorded',
  'kick.tapA11y': 'Tap when you feel a movement. {n} movements recorded so far.',
  'kick.endSessionA11y': 'End session, save this count',
  'kick.cancelA11y': 'Cancel, discard this count',
  'kick.undoA11y': 'Undo last count, subtract 1',
  'kick.timerA11y': 'Time elapsed: {time}',
  'kick.leaveGuardTitle': 'Stop counting and leave?',
  'kick.leaveGuardBody': 'You counted {n} movements in {time}.',
  'kick.leaveGuardSave': 'End session and save',
  'kick.leaveGuardContinue': 'Keep counting',
  'kick.leaveGuardDiscard': 'Cancel and discard',
  'kick.saveError': 'Could not save · Try again',
  'kick.draftSheetTitle': 'Session in progress',
  'kick.draftStartedAt': 'Started {date} at {time}',
  'kick.draftSummary': '{n} movements · {min} minutes elapsed',
  'kick.draftResume': 'Resume counting',
  'kick.draftFinalize': 'End session and save',
  'kick.draftDiscard': 'Cancel and discard this session',
  'kick.summaryTitle': 'Saved',
  'kick.summaryHeadline': 'Kick Count',
  'kick.summaryCountLabel': 'Movements',
  'kick.summaryDurationLabel': 'Time',
  'kick.summaryCount': '{n} movements',
  'kick.summaryDuration': '{min} min',
  'kick.summaryViewHistory': 'View in calendar',
  'kick.summaryDone': 'Done',
  'kick.historyEmpty': 'No sessions recorded yet',
  'kick.historyEmptyBody': 'Tap "Start Counting" below to begin.',
  'kick.historyRowA11y': '{time}, {n} movements, {min} minutes, week {wk}, tap for details',
  'kick.rowCount': '{n} movements',
  'kick.rowDuration': '{min} min',
  'kick.offlinePill': 'Offline · Saved locally',
  'kick.consentGateCaption': 'Consent required before recording',
  'kick.storeError': 'Could not read local data',
  'kick.postpartumBanner': 'Recorded during pregnancy · Read-only',
  'kick.detailCountLabel': 'Movements',
  'kick.detailDurationLabel': 'Time',
  'kick.detailWeekLabel': 'Gestational age',
  'kick.detailNoteLabel': 'My notes',
  'kick.detailExportPdf': 'Export to doctor PDF',
  'kick.detailWeekValue': 'Week {n}',
};

// ─── Exports ──────────────────────────────────────────────────────────────────

/** All valid message keys — inferred from the Thai catalog shape. */
export type MessageKey = keyof MsgShape;

/** The complete message catalog indexed by locale and then by MessageKey. */
export const catalog: Record<Locale, MsgShape> = { th, en };
