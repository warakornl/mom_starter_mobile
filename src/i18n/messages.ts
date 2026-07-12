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

// ─── Weekday short labels (calendar header row, Sun-first) ────────────────────
//
// Used by CalendarScreen's day-of-week header row.
// Week starts Sunday (index 0) to match the calendar grid's monthStartDow.
// EN: 3-letter abbreviations — at fontSize 12 in a 1/7-width column each column
// is ≥44px on all supported widths (≥320px screen), which comfortably holds
// 3-letter text (~21px max). Prefer 3-letter for clarity over 2-letter.

export const WEEKDAYS: Record<Locale, string[]> = {
  th: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
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

// ─── Month-year formatter (no day) ───────────────────────────────────────────

/**
 * Format a "YYYY-MM" string for display without a day component.
 *   th → "MMMM พ.ศ. YYYY+543"  (e.g. "มิถุนายน พ.ศ. 2569")
 *   en → "MMMM YYYY"            (e.g. "June 2026")
 *
 * Used by:
 *   - CalendarScreen month header (YYYY-MM-01 → .slice(0,7) → YYYY-MM)
 *   - DoctorPdfScreen month picker (via re-export in pdfReport/monthYearFormatter.ts)
 */
export function formatYearMonth(yyyyMm: string, locale: Locale): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (locale === 'th') {
    return `${MONTHS.th[m - 1]} พ.ศ. ${y + 543}`;
  }
  return `${MONTHS.en[m - 1]} ${y}`;
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
  'welcome.tagline': 'สมุดสีชมพูของคุณ สำหรับทุกช่วงเวลาของการตั้งครรภ์',
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
  'picker.selectMonth': 'เลือกเดือน',

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
  'home.errorHeadline': 'เปิดข้อมูลในเครื่องไม่สำเร็จ',
  'home.errorSubline': 'ข้อมูลของคุณยังอยู่ในเครื่อง',
  'home.logout': 'ออกจากระบบ',
  'home.logoutTitle': 'ออกจากระบบ',
  'home.logoutMessage': 'คุณต้องการออกจากระบบใช่ไหม?',
  'home.logoutCancel': 'ยกเลิก',
  'home.logoutConfirm': 'ออกจากระบบ',
  'home.settingsA11y': 'ตั้งค่า',
  'settings.title': 'ตั้งค่า',
  /** Navigation-row label used in Profile Hub → opens SettingsScreen (§2 feat-profile-header-settings-row). */
  'settings.navTitle': 'การตั้งค่า / Settings',
  'settings.account': 'บัญชีผู้ใช้',
  'settings.privacy': 'ความเป็นส่วนตัวและการยินยอม',
  // ── General section (language, app preferences) ───────────────────────────────
  'settings.general': 'ทั่วไป',
  'settings.language': 'ภาษา / Language',
  /** Displayed on the right of the language row when locale=th */
  'settings.languageValueTh': 'ไทย',
  /** Displayed on the right of the language row when locale=en */
  'settings.languageValueEn': 'English',
  // ── Edit pregnancy (settings section) ────────────────────────────────────────
  'settings.pregnancy': 'การตั้งครรภ์',
  'settings.editPregnancy': 'แก้ไขข้อมูลการตั้งครรภ์',
  'settings.editPregnancySubtitle': 'วันกำหนดคลอด / อายุครรภ์',

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
  // ── Edit pregnancy profile (edit host screen strings) ─────────────────────────
  'profile.editNavTitle': 'แก้ไขข้อมูลการตั้งครรภ์',
  'profile.editLoading': 'กำลังโหลดข้อมูลการตั้งครรภ์...',
  'profile.editLoadError': 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง',
  'profile.editLoadRetry': 'ลองอีกครั้ง',
  'profile.editNotFound': 'ยังไม่มีข้อมูลการตั้งครรภ์',
  'profile.editNotEditable': 'ไม่สามารถแก้ไขข้อมูลได้ในขั้นนี้',
  /** AC-10 R-3 conflict reload message (§5.2) */
  'profile.editConflictReloaded': 'ข้อมูลถูกแก้ไขจากอุปกรณ์อื่น เราดึงข้อมูลล่าสุดมาให้แล้ว กรุณาตรวจสอบและบันทึกอีกครั้ง',
  /** AC-15 discard-changes guard */
  'profile.editDiscardTitle': 'ทิ้งการแก้ไข?',
  'profile.editDiscardBody': 'การเปลี่ยนแปลงที่ยังไม่ได้บันทึกจะถูกลบ',
  'profile.editDiscardCancel': 'ยกเลิก',
  'profile.editDiscardConfirm': 'ทิ้ง',

  // ── Profile Hub screen (profile-tab-and-hub-ui.md v1.1 §13.1) ────────────────
  /** Inline header bar title — bilingual fixed label (§1 feat-profile-header-settings-row). */
  'profile.title': 'โปรไฟล์ / Profile',
  // Section headers
  'profile.section.profile': 'โปรไฟล์',
  'profile.section.accountData': 'บัญชีและข้อมูล',
  'profile.section.account': 'บัญชี',
  // Loading skeleton a11y label
  'profile.loading': 'กำลังโหลดข้อมูลโปรไฟล์',
  // Summary card fallback name — shown on the card when no name is entered
  'profile.summary.fallbackName': 'คุณแม่',
  // Summary card lifecycle badge texts
  'profile.summary.badgePregnant': 'ตั้งครรภ์',
  'profile.summary.badgePostpartum': 'หลังคลอด',
  // Summary card — postpartum day count (spec §3.3/§10.2); {n} = postpartumDays
  'profile.summary.postpartumDays': '{n} วันหลังคลอด',
  // Summary card — postpartum fallback when birthDate is absent
  'profile.summary.postpartumFallback': 'หลังคลอด',
  // Edit pregnancy row subtitle — distinct from settings.editPregnancySubtitle (§13.1)
  'profile.editPregnancy.subtitle': 'แก้ไข EDD และรายละเอียดการตั้งครรภ์',
  // Download data row
  'profile.downloadData.label': 'ดาวน์โหลดข้อมูลของฉัน',
  'profile.downloadData.subtitle': 'PDPA ม.30',
  // Delete account row
  'profile.deleteAccount.label': 'ลบบัญชีของฉัน',
  'profile.deleteAccount.subtitle': 'ถาวร ไม่สามารถกู้คืนได้',
  /**
   * Logout confirm dialog body — consequence statement (§3.6, §7.5).
   * NOT home.logoutMessage ("คุณต้องการออกจากระบบใช่ไหม?") — that is a yes/no question.
   * This key states the data-clearing consequence as the 3rd destructive signal.
   */
  'profile.logout.message': 'ระบบจะล้างข้อมูลทั้งหมดในอุปกรณ์นี้',

  // ── ProfileInfoEdit row in ProfileHub ────────────────────────────────────────
  // Lifecycle-agnostic row (pregnant AND postpartum) — name-fields-design.md §3.4
  // Row label in the Profile section of ProfileHubScreen
  'profile.infoEdit.rowLabel': 'แก้ไขชื่อ / ข้อมูลส่วนตัว',
  'profile.infoEdit.rowSubtitle': 'ชื่อคุณแม่และชื่อลูก',

  // Summary card mother first-name display (PDPA minimization: first name only on card)
  // Template: "คุณแม่ {name}" — {name} replaced with decoded motherFirstName
  // Falls back to profile.summary.fallbackName ("คุณแม่") when name is absent.
  'profile.summary.motherFirstName': 'คุณแม่ {name}',

  // ── ProfileInfoEditScreen (name fields — identity PII, PDPA §2.5) ─────────────
  // Screen title and subtitle
  'profileInfo.navTitle': 'แก้ไขข้อมูลส่วนตัว',
  'profileInfo.subtitle': 'ชื่อจะแสดงเฉพาะในแอปของคุณ',

  // Field labels (all optional)
  'profileInfo.field.motherFirstName': 'ชื่อ (คุณแม่)',
  'profileInfo.field.motherLastName': 'นามสกุล',
  'profileInfo.field.babyName': 'ชื่อลูก',
  'profileInfo.field.optional': '(ไม่บังคับ)',

  // Input placeholders
  'profileInfo.placeholder.motherFirstName': 'ชื่อจริง',
  'profileInfo.placeholder.motherLastName': 'นามสกุล',
  'profileInfo.placeholder.babyName': 'ชื่อลูก',

  // Validation — max 100 chars (api-contract: client trims + enforces ≤100)
  'profileInfo.validation.nameTooLong': 'ชื่อต้องไม่เกิน 100 ตัวอักษร',

  // Save button states
  'profileInfo.save': 'บันทึก',
  'profileInfo.saving': 'กำลังบันทึก...',
  'profileInfo.saved': 'บันทึกแล้ว',

  // Error messages (401 = SD-5 logout; 409 = version conflict)
  'profileInfo.error.login': 'กรุณาเข้าสู่ระบบใหม่',
  'profileInfo.error.conflict': 'มีการอัปเดตจากอุปกรณ์อื่น กรุณาลองอีกครั้ง',
  'profileInfo.error.generic': 'บันทึกไม่สำเร็จในขณะนี้',

  // Privacy note displayed below the form (PDPA minimization — user reassurance)
  'profileInfo.note.optional': 'ไม่บังคับ — ชื่อจะแสดงเฉพาะในแอปของคุณ',

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
  'supplies.autoDecrementSettings': 'ตั้งค่าตัดสต็อกอัตโนมัติ ›',
  'supplies.feedingLog': 'บันทึกการให้นม ›',

  // ── Auto-stock-decrement (ตัดสต็อกอัตโนมัติ) ──────────────────────────────────
  //
  // FW-1 HARD RULE: ALL formula-path strings MUST contain zero brand/promo/order
  // copy. Allowed: verbatim item name, integers, neutral verbs in allowlist.
  // See fw1Scanner.ts for the blocklist. Scan these on every CI run.
  //
  // Screen 1 — Auto-decrement settings
  'autoDecrement.navTitle': 'ตัดสต็อกอัตโนมัติ',
  'autoDecrement.backToSupplies': 'ของใช้ในบ้าน',
  'autoDecrement.loading': 'กำลังโหลด',
  'autoDecrement.offline': 'ออฟไลน์ · แสดงข้อมูลในเครื่อง',

  // Activity section headers (neutral Thai only — FW-1)
  'autoDecrement.activity.diaperChange': 'เปลี่ยนผ้าอ้อม',
  'autoDecrement.activity.formulaFeed': 'ให้นมผง',   // FW-1: no brand, no "formula brand"
  'autoDecrement.activity.bathing': 'อาบน้ำ',

  // Toggle
  'autoDecrement.toggleOn': 'เปิด',
  'autoDecrement.toggleOff': 'ปิด',
  /** accessibilityLabel for master toggle: "ตัดสต็อกอัตโนมัติ {activityName} {state}" */
  'autoDecrement.toggle.a11yLabel': 'ตัดสต็อกอัตโนมัติ {activityName} {state}',

  // Item-link row
  'autoDecrement.linkItem': '+ เชื่อมต่อของใช้',
  'autoDecrement.unlinkItem.a11yLabel': 'ยกเลิกการเชื่อมต่อ {itemName}',

  // Per-use units (caption, 13sp — FW-1 neutral verbs)
  'autoDecrement.unit.piece': 'ชิ้น/ครั้ง',    // pieces per use (diapers, cotton pads)
  'autoDecrement.unit.meal': 'มื้อ/ครั้ง',     // scoops/meals per use (formula) — FW-1 ✓
  'autoDecrement.unit.time': 'ครั้ง/ครั้ง',    // times per use (soap, shampoo)

  // Advisory states (Screen 1 inline advisories)
  // SP-4: no item name in advisory copy
  'autoDecrement.advisory.packSetupRequired': 'ตั้งค่าบรรจุภัณฑ์ก่อนเปิดใช้งาน',
  'autoDecrement.advisory.packSetupCta': 'ตั้งค่าบรรจุภัณฑ์ ›',
  'autoDecrement.advisory.consentRequired': 'เปิดใช้ได้เมื่อยินยอมบันทึกการให้นม',
  'autoDecrement.advisory.consentCta': 'เปิดสิทธิ์ ›',
  'autoDecrement.advisory.noItemLinked': 'ยังไม่ได้เชื่อมต่อของใช้',

  // Item picker — "Link an item" destination (Bug #2 fix)
  // FW-1: shows verbatim item names only — no brand/promo copy.
  'supplyItemPicker.navTitle': 'เลือกของใช้',
  'supplyItemPicker.emptyState': 'ยังไม่มีของใช้ในบ้าน ลองเพิ่มของใช้ก่อนนะคะ',
  'supplyItemPicker.backA11y': 'กลับ',

  // Screen 2 — Sub-unit setup (การตั้งค่าบรรจุภัณฑ์)
  'subUnitSetup.sectionTitle': 'การตัดสต็อกอัตโนมัติ',
  'subUnitSetup.usesPerContainerLabel': 'บรรจุภัณฑ์นี้มีกี่มื้อ/ครั้ง',
  'subUnitSetup.defaultQtyLabel': 'ตัดออกกี่มื้อ/ครั้ง (ค่าตั้งต้น)',
  'subUnitSetup.usesPerContainerError': 'บรรจุภัณฑ์ต้องมีอย่างน้อย 1 มื้อ',
  'subUnitSetup.echoPreviewLabel': 'จะแสดงเป็น:',
  /**
   * Echo line — FW-1 strict: {name} verbatim, {p} int, {q} int only.
   * Template: "{name} 1 บรรจุภัณฑ์ = {p} มื้อ · ตัดออก {q} มื้อ/ครั้ง"
   */
  'subUnitSetup.echoLine': '{name} 1 บรรจุภัณฑ์ = {p} มื้อ · ตัดออก {q} มื้อ/ครั้ง',

  // Steer-to-pack guided conversion (D-4)
  'subUnitSetup.steerToPack.title': 'เปลี่ยนวิธีนับเป็น "แพ็ค/บรรจุภัณฑ์"',
  /** Template: "ตอนนี้คุณมี: {name} {qty} ชิ้น" */
  'subUnitSetup.steerToPack.currentQty': 'ตอนนี้คุณมี: {name} {qty} ชิ้น',
  'subUnitSetup.steerToPack.itemsPerPackLabel': '1 แพ็ค มีกี่ชิ้น?',
  'subUnitSetup.steerToPack.echoPreviewLabel': 'จะเปลี่ยนเป็น:',
  /** Template: "{name}: 1 แพ็ค (เหลือ {remaining} ชิ้น)" */
  'subUnitSetup.steerToPack.echoLine': '{name}: 1 แพ็ค (เหลือ {remaining} ชิ้น)',
  'subUnitSetup.steerToPack.confirmBtn': 'ยืนยันการเปลี่ยน',
  'subUnitSetup.steerToPack.cancelBtn': 'ยกเลิก',
  'subUnitSetup.steerToPack.itemsPerPackError': 'ต้องมีอย่างน้อย 2 ชิ้น/แพ็ค เพื่อตัดสต็อกอัตโนมัติ',
  'subUnitSetup.itemNotFound': 'ไม่พบรายการสินค้า',
  'subUnitSetup.a11y.decrement': 'ลดจำนวน',
  'subUnitSetup.a11y.increment': 'เพิ่มจำนวน',

  // Screen 3 — Formula-feed chip (on existing feeding surface, SD-10 dual-gate)
  // FW-1 HARD: chip label is "ให้นมผง" only — no brand, no product name.
  'formulaFeed.chip': 'ให้นมผง',
  'formulaFeed.amountLabel': 'จำนวน (มื้อ/สกูป)',
  'formulaFeed.amountPlaceholder': '0',
  'formulaFeed.consentGate': 'เปิดสิทธิ์บันทึกการให้นมก่อนเพื่อใช้งาน',
  'formulaFeed.submit': 'บันทึกการให้นม',

  // FeedingLogScreen (Screen 3 surface — breastfeed / pump / formula logger)
  // SD-10: requires general_health for all; infant_feeding additionally for formula.
  // FW-1: no brand/buy/promo copy anywhere on this surface.
  'feedingLog.navTitle': 'บันทึกการให้นม',
  'feedingLog.breastfeed': 'นมแม่',
  'feedingLog.pump': 'ปั๊มนม',
  'feedingLog.save': 'บันทึก',
  'feedingLog.saved': 'บันทึกแล้ว',
  'feedingLog.close': 'ปิด',
  'feedingLog.error': 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
  'feedingLog.retry': 'ลองอีกครั้ง',
  'feedingLog.consentGate': 'เปิดสิทธิ์บันทึกสุขภาพก่อน',
  'feedingLog.consentCta': 'เปิดสิทธิ์ ›',

  // Screen 4 — Care-activity tag on reminder form (ReminderFormScreen extension)
  'reminder.careActivityType.fieldLabel': 'ประเภทกิจกรรมดูแล (ไม่บังคับ)',
  'reminder.careActivityType.none': 'ไม่ระบุ',
  'reminder.careActivityType.diaperChange': 'เปลี่ยนผ้าอ้อม',
  'reminder.careActivityType.bathing': 'อาบน้ำ',
  'reminder.careActivityType.a11yLabel': 'ประเภทกิจกรรมดูแล: {value}',

  // Low-supply cue (Screen 5 — in-app toast + push notification body)
  // SP-4/FW-1: generic only — no item name in push body, no brand.
  // Push notification body is scanned by fw1Scanner on CI.
  'lowSupply.cue.inApp': 'นมผงของคุณใกล้หมด',         // FW-1 ✓ no brand
  'lowSupply.cue.push.title': 'มีของใกล้หมด',          // generic — SP-4 ✓ no item name
  'lowSupply.cue.push.body': 'ของใช้ในบ้านใกล้หมด กรุณาตรวจสอบ', // FW-1 ✓ no brand/buy
  'lowSupply.restock.push.title': 'เติมสต็อก',
  'lowSupply.restock.push.body': 'ถึงเวลาเติมสต็อกของบ้าน',   // FW-1 ✓ neutral

  // Calendar (ปฏิทิน) ─────────────────────────────────────────────────────────
  'calendar.navTitle': 'ปฏิทิน',
  'calendar.today': 'วันนี้',
  'calendar.empty': 'ไม่มีกิจกรรมในวันนี้',
  'calendar.loading': 'กำลังโหลด',
  'calendar.offline': 'ออฟไลน์ · แสดงข้อมูลในเครื่อง',
  'calendar.viewAll': 'ดูทั้งหมด',
  /** Home-screen shortcut button: self-descriptive label naming the destination and daily-log. */
  'calendar.shortcutBtn': 'ปฏิทินและบันทึกรายวัน ›',
  'calendar.addAppointment': '+ นัดหมายใหม่',
  'calendar.addReminder': '+ เตือนความจำใหม่',
  'calendar.addCapture': '+ บันทึกสุขภาพ',
  /** Accessibility labels (no leading "+") for the three Day-Detail add pills.
   *  Used as accessibilityLabel so screen readers announce the action clearly. */
  'calendar.addAppointment.a11yLabel': 'เพิ่มนัดหมาย',
  'calendar.addReminder.a11yLabel': 'เพิ่มเตือนความจำ',
  'calendar.addCapture.a11yLabel': 'บันทึกสุขภาพ',
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
  /**
   * Kick-count agenda row label — calendar day detail (feat-kickcount-in-calendar).
   * template: {count} = movementCount integer.
   * Security K-8: displayed to the owner only; never logged.
   */
  'calendar.kickCount.label': 'นับลูกดิ้น: {count} ครั้ง',

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
  /** DEF-01 fix: shown in date field when date is blank (ANC_PREFILL_DATE=OFF). */
  'appointment.datePlaceholder': 'เลือกวันที่',

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
  /** NEW B2 ห้องแม่ — milestone preset templates section label */
  'reminder.milestonePresetsLabel': 'เลือกจากแม่แบบ',

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
  'kick.endSessionBtn': 'เสร็จสิ้น',
  'kick.cancelBtn': 'ยกเลิก',
  /** K-5b: SR label — "นับได้ N ครั้ง" no "/10" no "goal" */
  /** template: {n} = current count */
  'kick.progressA11y': 'นับได้ {n} ครั้ง',
  /** template: {n} = current count */
  'kick.tapA11y': 'แตะเมื่อรู้สึกดิ้น ตอนนี้นับได้ {n} ครั้งแล้ว',
  'kick.endSessionA11y': 'เสร็จสิ้นการนับ บันทึกการนับครั้งนี้',
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
  // Loss-state replacement (lifecycle='ended') — Gate 2 (G2-DELIV) + Gate 1 supplementary
  'kick.lossReplacement': 'ฟีเจอร์นี้ไม่พร้อมใช้งานในขณะนี้',
  'kick.lossGoBack': 'กลับ',
  // SC-K5 detail
  'kick.detailCountLabel': 'นับได้',
  'kick.detailDurationLabel': 'เวลาที่ใช้',
  'kick.detailWeekLabel': 'อายุครรภ์',
  'kick.detailNoteLabel': 'บันทึกของฉัน',
  'kick.detailExportPdf': 'ส่งออกเป็น PDF หมอ',
  /** template: {n} = week */
  'kick.detailWeekValue': 'สัปดาห์ {n}',

  // ── Kick-count history chart + date-range picker (SC-K4 chart feature) ────────
  /** Section label above the chart. */
  'kick.chartTitle': 'ลูกดิ้นรายวัน',
  /** Label for the date-range picker row. */
  'kick.chartDateRange': 'ช่วงวันที่',
  /** "From" picker label. */
  'kick.chartFrom': 'จาก',
  /** "To" picker label. */
  'kick.chartTo': 'ถึง',
  /** Quick preset chip — 7 days. */
  'kick.chart7d': '7 วัน',
  /** Quick preset chip — 14 days. */
  'kick.chart14d': '14 วัน',
  /** Quick preset chip — 30 days. */
  'kick.chart30d': '30 วัน',
  /** Empty-state message when no sessions in the selected range. */
  'kick.chartEmpty': 'ยังไม่มีข้อมูลในช่วงนี้',
  /**
   * A11y label for the chart View.
   * template: {n} = number of days, {max} = highest daily total.
   */
  'kick.chartA11y': 'กราฟจำนวนลูกดิ้นรายวัน {n} วัน สูงสุด {max} ครั้ง',

  // ── Consent (PDPA ม.26 / ม.20) ────────────────────────────────────────────────
  // Keys per first-run-consent.md §6 + consent-copy.md (v1.0 DRAFT — lawyer review pending §Z-2).
  // Text version tag: "v1.0-th" (Thai) / "v1.0-en" (English).
  // ⚠️ DRAFT: copy is informational; licensed Thai legal counsel must approve before launch.

  // S3 screen chrome
  'consent.screen.title': 'สมุดสุขภาพของคุณ',
  'consent.screen.subtitle': 'เลือกวิธีดูแลข้อมูลของคุณ — คุณเป็นผู้ตัดสินใจ และเปลี่ยนได้ทุกเมื่อ',
  'consent.screen.continue_btn': 'ดำเนินการต่อ',
  'consent.screen.saving': 'กำลังบันทึก',

  // general_health consent (S3 item 1 — §2 consent-copy.md)
  'consent.general_health.title': 'บันทึกสุขภาพในเครื่อง',
  'consent.general_health.data_copy': 'ข้อมูลสุขภาพระหว่างตั้งครรภ์ถึงหลังคลอดที่คุณกรอกเอง เช่น กำหนดคลอด (EDD) น้ำหนัก ความดัน ยาที่แพทย์สั่ง อาการที่คุณสังเกต การนับลูกดิ้น และวิธีคลอด ข้อมูลนี้ถือเป็น "ข้อมูลสุขภาพ" ที่กฎหมายคุ้มครองเป็นพิเศษ และถูกเก็บไว้ในเครื่องของคุณ',
  'consent.general_health.purpose_copy': 'เพื่อบันทึกข้อมูลสุขภาพของคุณลงในสมุดสุขภาพในแอป และช่วยสรุปให้คุณนำไปคุยกับคุณหมอได้ง่ายขึ้น เราใช้ข้อมูลนี้เพื่อ "เตือน บันทึก และสรุป" เท่านั้น ไม่นำไปวินิจฉัยโรค ไม่วิเคราะห์ค่าสุขภาพแทนแพทย์ และไม่นำไปทำโฆษณา',
  'consent.general_health.grant_btn': 'ให้ความยินยอม',
  'consent.general_health.granted_label': 'บันทึกไว้แล้ว',
  'consent.general_health.required_note': 'ยังไม่ได้ให้ความยินยอมบันทึกสุขภาพ',
  // Skip sheet (§3.1.6) — shown when user taps Continue without general_health
  'consent.general_health.skip_sheet.title': 'ยังไม่ได้ยินยอมบันทึกสุขภาพ',
  'consent.general_health.skip_sheet.body': 'ไม่เป็นไรค่ะ คุณยังใช้แอปได้ในโหมดอ่านอย่างเดียว — เปิดดูปฏิทิน คำแนะนำ และเนื้อหาต่าง ๆ ได้ตามปกติ แต่จะยัง บันทึกข้อมูลสุขภาพ (เช่น กำหนดคลอด ยา หรือน้ำหนัก) ไม่ได้ จนกว่าจะเปิดสิทธิ์นี้ เปิดได้ทุกเมื่อที่ บัญชี › จัดการความยินยอม',
  'consent.general_health.skip_sheet.go_back_btn': 'กลับและให้ความยินยอม',
  'consent.general_health.skip_sheet.continue_anyway_btn': 'ดำเนินการต่อโดยไม่บันทึก',

  // cloud_storage consent (S3 item 2 — §3 consent-copy.md)
  'consent.cloud_storage.title': 'ซิงค์ข้ามอุปกรณ์',
  'consent.cloud_storage.data_copy': 'ข้อมูลสุขภาพชุดเดียวกับที่คุณบันทึกไว้ในเครื่อง จะถูกส่งไปเก็บอย่างปลอดภัยบนเซิร์ฟเวอร์ของเราซึ่งตั้งอยู่ในประเทศไทย ข้อมูลถูกเข้ารหัสทั้งตอนส่งและตอนเก็บ',
  'consent.cloud_storage.purpose_copy': 'เพื่อให้โทรศัพท์และแท็บเล็ตของคุณเห็นข้อมูลเดียวกัน และมีสำเนาสำรองไว้เผื่อเปลี่ยนเครื่องหรือทำเครื่องหาย',
  'consent.cloud_storage.off_note': 'ปิดได้ ใช้งานเต็มรูปแบบในเครื่อง',

  // Shared consent UI
  'consent.text_version.label': 'เวอร์ชันข้อความ',
  'consent.policy_link': 'นโยบายความเป็นส่วนตัว',
  'consent.change_later_note': 'คุณเปลี่ยนสิทธิ์เหล่านี้ได้ทุกเมื่อใน บัญชี › จัดการความยินยอม',

  // Error / retry panel (§3.1.5)
  'consent.error.save_failed': 'บันทึกไม่สำเร็จ · จะลองใหม่อัตโนมัติ',
  'consent.error.retry_btn': 'ลองอีกครั้ง',

  // Home screen limited-mode elements (§3.1.6, §4.3)
  'consent.home.health_nudge_banner': 'เปิดสิทธิ์บันทึกสุขภาพ ›',
  'consent.limited_mode.health_gate_inline': 'ต้องให้ความยินยอมบันทึกสุขภาพก่อน · เปิดสิทธิ์ ›',
  'consent.limited_mode.health_gate_feeding_context': 'ต้องเปิดสิทธิ์บันทึกสุขภาพก่อนเพื่อบันทึกการให้นม',

  // Settings entry point
  'consent.settings.manage_btn': 'จัดการความยินยอม',

  // ── pdf_egress JIT sheet (§3.2a + consent-copy.md §4) ──────────────────────
  'consent.pdf_egress.title': 'สร้าง PDF สรุปให้คุณหมอ',
  'consent.pdf_egress.body_copy': 'ข้อมูลสุขภาพของคุณจะถูกรวบรวมเป็นไฟล์ PDF เพื่อให้คุณนำไปให้คุณหมอดูได้สะดวก ไฟล์นี้ถูกสร้างขึ้นเพื่อคุณเท่านั้น เราไม่ส่งไปที่อื่น',
  'consent.pdf_egress.grant_btn': 'ยินยอม',
  'consent.pdf_egress.blocked_inline': 'ต้องให้ความยินยอมก่อนสร้าง PDF · ไปที่ จัดการความยินยอม ›',

  // ── sensitive_lab_results JIT sheet (§3.2b + consent-copy.md §5) ─────────
  'consent.sensitive_lab.title': 'รวมบันทึกผลตรวจในรายงาน',
  'consent.sensitive_lab.body_copy': 'ในรายการตรวจต่าง ๆ คุณอาจพิมพ์บันทึกอิสระไว้ ซึ่งบางครั้งอาจมีผลตรวจที่อ่อนไหวมาก เช่น ผลเลือดหรือผลคัดกรอง หากคุณยินยอม เราจะรวมบันทึกเหล่านี้ไว้ในไฟล์ PDF เพื่อให้คุณหมอเห็นครบ ระบบไม่เคยอ่านหรือแยกแยะเนื้อหาในบันทึกของคุณ',
  'consent.sensitive_lab.hide_note': 'ถ้าปิด บันทึกจะถูกซ่อน ยังสร้าง PDF ได้',
  'consent.sensitive_lab.grant_btn': 'ยินยอมและรวมบันทึก',
  'consent.sensitive_lab.hide_btn': 'ซ่อนบันทึก',

  // ── infant_feeding JIT sheet (§3.2c + consent-copy.md §6.1) ──────────────
  'consent.infant_feeding.title': 'บันทึกการให้นมลูก',
  'consent.infant_feeding.body_copy': 'ข้อมูลนี้เป็นข้อมูลของลูกคุณ คุณกำลังให้ความยินยอมในฐานะผู้ใช้อำนาจปกครอง เราจะเก็บ เวลา ปริมาณ ข้างที่ให้นม และบันทึกอิสระที่คุณพิมพ์ เพื่อช่วยคุณบันทึกการให้นมและรวมไว้ในรายงาน PDF ให้คุณหมอ',
  'consent.infant_feeding.parental_note': 'ข้อมูลของลูก · คุณยินยอมในฐานะผู้ปกครอง',
  'consent.infant_feeding.grant_btn': 'ยินยอม (ในฐานะผู้ปกครอง)',
  'consent.infant_feeding.parental_attest_label': 'ฉันเป็นผู้ปกครอง/ผู้ใช้อำนาจปกครองของเด็กคนนี้',

  // ── child_health JIT sheet (§3.2d + consent-copy.md §6.2) ────────────────
  'consent.child_health.title': 'สุขภาพและอาการของลูก',
  'consent.child_health.body_copy': 'ข้อมูลนี้เป็นข้อมูลสุขภาพของลูกคุณ ซึ่งกฎหมายคุ้มครองเป็นพิเศษ คุณกำลังให้ความยินยอมในฐานะผู้ใช้อำนาจปกครอง เราจะเก็บ อาการของลูกและบันทึกสุขภาพที่คุณจดไว้ เพื่อบันทึกในเครื่อง ซิงค์ และรวมในรายงาน PDF ให้คุณหมอ',
  'consent.child_health.parental_note': 'ข้อมูลของลูก · คุณยินยอมในฐานะผู้ปกครอง',
  'consent.child_health.browse_note': 'การดูคำแนะนำอาการโดยไม่บันทึกไม่ต้องการความยินยอมนี้',
  'consent.child_health.grant_btn': 'ยินยอม (ในฐานะผู้ปกครอง)',
  'consent.child_health.parental_attest_label': 'ฉันเป็นผู้ปกครอง/ผู้ใช้อำนาจปกครองของเด็กคนนี้',

  // ── Shared JIT sheet UI (§3.2e) ─────────────────────────────────────────
  'consent.jit.decline_btn': 'ไม่ใช่ตอนนี้',
  'consent.jit.change_later_note': 'เปลี่ยนใจได้ที่ บัญชี › จัดการความยินยอม',
  'consent.jit.saving': 'กำลังบันทึก',
  'consent.jit.save_failed': 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
  'consent.jit.retry_btn': 'ลองใหม่',

  // ── S8 Manage-Consents screen (§3.3 + consent-copy.md §7) ────────────────
  'consent.manage.title': 'จัดการความยินยอม',
  'consent.manage.subtitle': 'เปิดหรือปิดได้ทุกเมื่อ การปิดไม่ใช่การลบข้อมูล',
  'consent.manage.section.core': 'ฟีเจอร์หลัก',
  'consent.manage.section.sync': 'การซิงค์และรายงาน',
  'consent.manage.section.baby': 'ข้อมูลของลูก',

  // S8 row short captions (§3.3.1 wireframe)
  'consent.manage.row.general_health.caption': 'วันคลอด · ยา · น้ำหนัก · อาการ',
  'consent.manage.row.cloud_storage.caption': 'บันทึกเห็นเหมือนกันทุกเครื่อง',
  'consent.manage.row.pdf_egress.caption': 'สรุปให้คุณหมอ',
  'consent.manage.row.sensitive_lab.caption': 'บันทึกอิสระในรายการตรวจทุกหมวด',

  // S8 withdrawal confirmation sheets (§3.3.2 + consent-copy.md §7)
  'consent.manage.withdraw_confirm.general_health.title': 'ปิดการบันทึกสุขภาพ',
  'consent.manage.withdraw_confirm.general_health.body': 'ข้อมูลสุขภาพที่คุณบันทึกไว้แล้วยังคงอยู่ในเครื่องนี้อย่างปลอดภัย — การปิดสิทธิ์ไม่ใช่การลบข้อมูล สิ่งที่เปลี่ยนคือ คุณจะยังบันทึกข้อมูลสุขภาพใหม่ไม่ได้จนกว่าจะเปิดสิทธิ์นี้อีกครั้ง',
  'consent.manage.withdraw_confirm.cloud_storage.title': 'ปิดการซิงค์',
  'consent.manage.withdraw_confirm.cloud_storage.body': 'ข้อมูลทั้งหมดของคุณยังอยู่ในเครื่องนี้อย่างปลอดภัย เราจะหยุดซิงค์ข้อมูลใหม่ทันที ส่วนข้อมูลที่เคยเก็บบนคลาวด์จะถูกลบตามนโยบายการเก็บรักษาข้อมูล (ไม่ใช่ลบทันที)',
  'consent.manage.withdraw_confirm.infant_feeding.title': 'ปิดการบันทึกการให้นม',
  'consent.manage.withdraw_confirm.infant_feeding.body': 'บันทึกการให้นมของลูกที่เก็บไว้แล้วยังอยู่ปลอดภัย การปิดสิทธิ์ไม่ใช่การลบข้อมูล คุณจะยังบันทึกและซิงค์การให้นมใหม่ไม่ได้จนกว่าจะเปิดอีกครั้ง',
  'consent.manage.withdraw_confirm.child_health.title': 'ปิดการบันทึกสุขภาพของลูก',
  'consent.manage.withdraw_confirm.child_health.body': 'บันทึกสุขภาพและอาการของลูกที่เก็บไว้แล้วยังอยู่ปลอดภัย การปิดสิทธิ์ไม่ใช่การลบข้อมูล คุณจะยังบันทึกและซิงค์ข้อมูลสุขภาพของลูกใหม่ไม่ได้จนกว่าจะเปิดอีกครั้ง',
  'consent.manage.withdraw_confirm.do_it_btn': 'ปิดสิทธิ์นี้',
  'consent.manage.withdraw_confirm.cancel_btn': 'ยกเลิก',

  // S8 loading / error states (§3.3.0)
  'consent.manage.load_error': 'โหลดไม่สำเร็จ ลองอีกครั้ง',
  'consent.manage.load_retry_btn': 'ลองอีกครั้ง',
  'consent.manage.pending_sync_badge': 'รอซิงค์',

  // S8 footer
  'consent.manage.policy_link': 'นโยบายความเป็นส่วนตัว',
  'consent.manage.history_link': 'ประวัติความยินยอม',

  // Toast feedback (§5 — consent-success-toast-grant / consent-success-toast-withdraw)
  'consent.success.toast_grant': 'ให้ความยินยอมแล้ว',
  'consent.success.toast_off': 'สิทธิ์ปิดแล้ว',
  'consent.success.toast_on': 'ซิงค์เปิดอยู่',

  // Home banner: policy version update (§4.6)
  'consent.home.version_update_banner': 'นโยบายความเป็นส่วนตัวมีการอัปเดต · ดูสิ่งที่เปลี่ยนแปลง ›',

  // Consent history (§6)
  'consent.history.title': 'ประวัติความยินยอม',
  'consent.history.item.granted': 'ให้ความยินยอม',
  'consent.history.item.withdrawn': 'ถอนความยินยอม',

  // ── Suggestion system (suggestion-flow-ui.md) ─────────────────────────────
  // Home banner — §5.3 suggestion banner (single, light, routes out)
  'suggestion.banner.headline': 'มีสิ่งใหม่ให้ติดตามในช่วงนี้',
  'suggestion.banner.view': 'ดูทั้งหมด',
  'suggestion.banner.dismiss': 'ปิด',
  'suggestion.banner.dismissA11y': 'ปิดข้อเสนอแนะนี้',
  'suggestion.banner.notMedicalAdvice': 'ไม่ใช่คำแนะนำทางการแพทย์',

  // Suggestion flow screen — suggestion-flow-ui.md §1 / §3
  'suggestion.screen.title': 'สิ่งที่น่าติดตามช่วงนี้',
  'suggestion.screen.offers': 'สิ่งเหล่านี้เป็นข้อเสนอ ไม่ใช่คำสั่ง',
  'suggestion.screen.empty': 'ตอนนี้ไม่มีสิ่งใหม่ให้ติดตาม',
  'suggestion.screen.viewHidden': 'ดูที่เคยซ่อน',
  'suggestion.screen.notMedicalAdvice': 'ไม่ใช่คำแนะนำทางการแพทย์ · อ่านข้อจำกัด',

  // Suggestion card actions — §2.2
  'suggestion.action.start': 'เริ่ม',
  'suggestion.action.snooze': 'เลื่อน',
  'suggestion.action.dismiss': 'ไม่เอา',
  'suggestion.action.reenable': 'เปิดใหม่',
  'suggestion.action.snoozeTitle': 'ถามใหม่เมื่อไหร่?',
  'suggestion.action.snooze3d': '3 วัน',
  'suggestion.action.snooze7d': '7 วัน',
  'suggestion.action.snooze14d': '14 วัน',
  'suggestion.action.snoozeConfirm': 'ยืนยัน',
  'suggestion.action.snoozeCancel': 'ยกเลิก',
  'suggestion.hidden.toast': 'ซ่อนแล้ว',
  'suggestion.hidden.undo': 'เลิกทำ',

  // Dismissed list screen — §3.1
  'suggestion.dismissed.title': 'รายการที่ซ่อนไว้',
  'suggestion.dismissed.empty': 'ยังไม่มีรายการที่ซ่อนไว้',

  // Evidence ribbons — §2.1 (provenance, not recommendation strength)
  'suggestion.evidence.HIGH': 'อ้างอิงหลักฐาน (HIGH) · รอการรับรองทางคลินิก',
  'suggestion.evidence.STRONG': 'มาตรฐานที่ยอมรับ (STRONG)',
  'suggestion.evidence.MODERATE': 'แนวปฏิบัติทั่วไป (MODERATE)',
  'suggestion.source.prefix': 'ที่มา: ',

  // Capture-type glyphs — a11y labels (§6)
  'suggestion.captureType.kick_count': 'นับลูกดิ้น',
  'suggestion.captureType.medication': 'ยาและวิตามิน',
  'suggestion.captureType.appointment': 'นัดหมาย',
  'suggestion.captureType.supplies': 'ของใช้',
  'suggestion.captureType.self_log': 'บันทึกส่วนตัว',

  // Suggestion item titles and reason text — §2.1
  'suggestion.kick_count_start.title': 'นับลูกดิ้น',
  'suggestion.kick_count_start.reason': 'ช่วยให้คุณและคุณหมอติดตามการเคลื่อนไหวของลูกรายวัน ช่วงนี้แนะนำให้เริ่มนับหลังมื้ออาหาร',
  'suggestion.triferdine_daily.title': 'Triferdine 150 (ไอรอน + กรดโฟลิก) ทุกวัน',
  'suggestion.triferdine_daily.reason': 'ช่วยลดโอกาสโลหิตจางระหว่างตั้งครรภ์',
  'suggestion.anc_t1_checkup.title': 'นัดฝากครรภ์ครั้งแรก',
  'suggestion.anc_t1_checkup.reason': 'ไตรมาสแรกเป็นช่วงสำคัญที่ควรเริ่มดูแลครรภ์',
  'suggestion.anc_t2_checkup.title': 'นัดตรวจครรภ์ไตรมาส 2',
  'suggestion.anc_t2_checkup.reason': 'ตรวจพัฒนาการลูกและสุขภาพของคุณ',
  'suggestion.anc_t3_checkup.title': 'นัดตรวจครรภ์ไตรมาส 3',
  'suggestion.anc_t3_checkup.reason': 'เตรียมพร้อมสำหรับการคลอดและตรวจท่าลูก',
  /**
   * ANC cadence suggestion (CK-B) — doctor-signed invitation copy (INV-A2/A5).
   * These are the i18n keys for the SuggestionCard title+reason slot.
   * The full card disclaimer, form disclaimer, and date labels live in ancConfig.ts
   * as LocalizedContent (direct use — not keyed through i18n).
   */
  'suggestion.anc_next_checkup.title': 'ถึงช่วงที่แนะนำให้นัดตรวจครรภ์ครั้งถัดไปแล้ว — อยากเพิ่มนัดไหม?',
  'suggestion.anc_next_checkup.reason': 'การฝากครรภ์ตามนัดช่วยให้คุณหมอติดตามพัฒนาการของลูกและสุขภาพของคุณได้ต่อเนื่อง',
  // Reminder toggle (AppointmentFormScreen — Surface 6)
  'appointment.reminder.toggleLabel': 'ตัวเตือน',
  'appointment.reminder.lead': 'ก่อนนัด 1 วัน เวลา 18:00',
  /**
   * PDPA-A4 helper note — shown when reminder toggle is ON to set expectation
   * that the lock-screen notification will use a generic title (not appointment name).
   */
  'appointment.reminder.lockScreenNote': 'การแจ้งเตือนบนหน้าจอล็อกจะแสดงชื่อทั่วไป (ไม่ใช่ชื่อนัด)',
  'suggestion.supplies_checklist.title': 'เตรียมของใช้ก่อนคลอด',
  'suggestion.supplies_checklist.reason': 'ช่วยให้พร้อมก่อนวันคลอดจะมาถึง',
  'suggestion.postnatal_checkup.title': 'นัดตรวจหลังคลอด',
  'suggestion.postnatal_checkup.reason': 'ติดตามสุขภาพหลังคลอด — โดยทั่วไปนัดที่ 6 สัปดาห์',
  'suggestion.baby_feeding_log.title': 'บันทึกการให้นม',
  'suggestion.baby_feeding_log.reason': 'ช่วยติดตามตารางให้นมและปริมาณสำหรับลูกน้อย',

  // ── PDF Doctor Report (pdf-doctor-ui.md) ─────────────────────────────────────
  // Entry point button and all UI states for the on-device doctor-summary PDF.
  'pdf.cta': 'สร้าง PDF ให้หมอ',
  'pdf.ctaA11y': 'สร้าง PDF สรุปสุขภาพสำหรับแพทย์',
  'pdf.generating': 'กำลังสร้าง PDF...',
  'pdf.shared': 'แชร์ไฟล์แล้ว',
  'pdf.sharedSubline': 'PDF ถูกเปิดในแอปที่คุณเลือก',
  'pdf.error': 'สร้าง PDF ไม่สำเร็จ · ลองอีกครั้ง',
  'pdf.retry': 'ลองอีกครั้ง',
  'pdf.consentBlocked': 'ต้องให้ความยินยอมก่อนสร้าง PDF · ไปที่ จัดการความยินยอม ›',
  /** Re-arm affordance (spec §4 — decline is frictionless and re-armable). */
  'pdf.tryConsent': 'ลองอีกครั้ง / ยินยอม',

  // ── Doctor PDF Screen (pdf-doctor-ui.md §1–§5) ────────────────────────────
  'pdf.screen.navTitle': 'รายงานสำหรับแพทย์',
  'pdf.screen.builderTitle': 'รายงานสำหรับแพทย์',
  'pdf.screen.previewNavTitle': 'ตัวอย่างรายงาน',
  'pdf.screen.dateRangeLabel': 'ช่วงเวลา',
  'pdf.screen.monthFrom': 'เดือนเริ่ม',
  'pdf.screen.monthTo': 'เดือนสิ้นสุด',
  'pdf.screen.monthRangeError': 'เดือนเริ่มต้องไม่อยู่หลังเดือนสิ้นสุด',
  'pdf.screen.manifestTitle': 'จะรวมอะไรบ้าง',
  'pdf.screen.manifestMedication': 'ยาและการกินยา (adherence)',
  'pdf.screen.manifestKickCounts': 'การนับลูกดิ้น',
  'pdf.screen.manifestSelfLogs': 'บันทึกตนเอง (น้ำหนัก/ความดัน/บวม)',
  'pdf.screen.manifestAppointments': 'นัดหมายและเช็กลิสต์',
  'pdf.screen.manifestLabNotes': 'ผลแล็บ/บันทึกข้อความ (HIV ฯลฯ)',
  'pdf.screen.manifestLabDefault': 'ค่าเริ่มต้น: ซ่อนไว้',
  'pdf.screen.whereTitle': 'ไฟล์นี้จะไปไหน',
  'pdf.screen.whereLine1': 'สร้างบนเครื่องนี้ · แชร์เมื่อคุณสั่ง',
  'pdf.screen.whereLine2': 'ไม่เก็บสำเนาบนคลาวด์โดยไม่ได้ขอ',
  'pdf.screen.previewBtn': 'ดูตัวอย่าง / Preview',
  'pdf.screen.shareBtn': 'แชร์',
  'pdf.screen.printBtn': 'พิมพ์',
  'pdf.screen.backToEdit': '‹ แก้ไข',
  'pdf.screen.generating': 'กำลังสร้างรายงาน...',
  'pdf.screen.errorTitle': 'สร้างรายงานไม่สำเร็จ ลองอีกครั้ง',
  'pdf.screen.retryBtn': 'ลองอีกครั้ง',
  'pdf.screen.sensitiveFileReminder': 'ไฟล์นี้มีข้อมูลละเอียดอ่อน',

  // ── Expenses (ค่าใช้จ่าย) ────────────────────────────────────────────────────
  // Spec: expenses-ui.md §1–§9. Amount stored as satang (฿1=100 satang),
  // displayed as ฿ with 2 decimals. note is encrypted (EX-2), never parsed.
  // No notifications, no alerts, no budget target (expenses-feature §3.3/§5).
  'expenses.navTitle': 'ค่าใช้จ่าย',
  'expenses.shortcutBtn': 'ค่าใช้จ่าย ›',
  // Month total (§2.1)
  'expenses.totalLabel': 'เดือนนี้ใช้ไป',
  /** template: {n} = count */
  'expenses.totalCount': '{n} รายการ',
  // Category breakdown (§2.2)
  'expenses.category.baby-supplies': 'ของใช้เด็ก',
  'expenses.category.healthcare': 'สุขภาพ',
  'expenses.category.baby-gear': 'ของใช้ลูก',
  'expenses.category.mother': 'แม่',
  'expenses.category.other': 'อื่นๆ',
  // List + empty (§4.2/§4.3)
  'expenses.emptyHeadline': 'ยังไม่มีรายการในเดือนนี้',
  'expenses.emptyBody': 'จดค่าใช้จ่ายไว้ แล้วดูยอดรวมของเดือนได้ที่นี่',
  'expenses.emptyPastMonth': 'ไม่มีรายการในเดือนนี้',
  'expenses.addFirst': '+ เพิ่มรายการแรก',
  // Row labels
  'expenses.noNote': '(ไม่มีบันทึก)',
  // FAB + sheet header (§3.2)
  'expenses.add': '+ เพิ่มรายการ',
  'expenses.addTitle': 'เพิ่มรายการ',
  'expenses.editTitle': 'แก้ไขรายการ',
  // Form fields (§3.2)
  'expenses.fieldAmount': 'จำนวนเงิน',
  'expenses.fieldCategory': 'หมวดหมู่',
  'expenses.fieldDate': 'วันที่',
  'expenses.fieldNote': 'บันทึกเพิ่ม (ไม่บังคับ)',
  'expenses.notePrivacyLine': 'เก็บไว้ในเครื่อง · ไม่ถูกอ่านหรือวิเคราะห์',
  // Echo line (§3.2)
  'expenses.echoPrefix': 'จะบันทึกเป็น:',
  // Save / Delete / Cancel (§3.2)
  'expenses.save': 'บันทึก',
  'expenses.delete': 'ลบรายการนี้',
  'expenses.deleteUndo': 'เลิกทำ',
  'expenses.deleteToast': 'ลบแล้ว',
  // Validation (§3.2)
  'expenses.errorAmountRequired': 'ใส่จำนวนเงินมากกว่า 0',
  // Sync status
  'expenses.loading': 'กำลังโหลด',
  'expenses.syncError': 'ซิงค์ไม่สำเร็จ · ลองอีกครั้ง',
  'expenses.conflictNote': 'อัปเดตจากอุปกรณ์อื่น',
  'expenses.rejectedNote': 'บางรายการถูกปฏิเสธ',
  'expenses.refresh': 'รีเฟรช',
  // Offline pill (spec §4.5 — calm warm-neutral; list stays interactive)
  'expenses.offlinePill': 'ออฟไลน์ · บันทึกไว้ในเครื่องแล้ว',
  // Error state (§4.4)
  'expenses.errorHeadline': 'เปิดข้อมูลในเครื่องไม่สำเร็จ',
  'expenses.errorSubline': 'ข้อมูลของคุณยังอยู่',

  // ── Quick Capture / Self-Log (capture-ui.md §2/§3/§4/§5) ─────────────────────
  'capture.navTitle': 'บันทึกข้อมูล',
  'capture.close': 'ปิด',
  'capture.save': 'บันทึก',
  'capture.typeLabel': 'ประเภท:',
  'capture.type.weight': 'น้ำหนัก',
  'capture.type.blood_pressure': 'ความดัน',
  'capture.type.swelling': 'บวม',
  'capture.type.lochia': 'น้ำคาวปลา',
  'capture.type.symptom': 'อาการ',
  'capture.field.when': 'เมื่อ',
  'capture.field.note': 'บันทึกเพิ่ม (ไม่บังคับ)',
  'capture.field.notePlaceholder': 'พิมพ์...',
  'capture.field.valuePlaceholder': 'พิมพ์ค่า',
  'capture.field.textPlaceholder': 'บรรยาย...',
  'capture.notePrivacy': 'เก็บไว้ในเครื่อง · ไม่ถูกอ่านหรือวิเคราะห์',
  'capture.echoPrefix': 'จะบันทึกเป็น:',
  'capture.echoPlaceholder': '— กรอกค่าเพื่อดูตัวอย่าง —',
  'capture.saved': 'บันทึกแล้ว',
  'capture.savedMsg': 'บันทึกข้อมูลสำเร็จ',
  'capture.viewCalendar': 'ดูในปฏิทิน',
  'capture.done': 'เสร็จ',
  'capture.error': 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
  'capture.retry': 'ลองอีกครั้ง',
  // Consent nudge (self-log-behavior §B.4 — general_health gate)
  'capture.consent.title': 'ต้องให้ความยินยอมก่อนบันทึกสุขภาพ',
  'capture.consent.body': 'เปิดสิทธิ์บันทึกสุขภาพเพื่อบันทึกน้ำหนัก ความดัน และอาการต่างๆ — ข้อมูลเก็บไว้ในเครื่องเท่านั้น',
  'capture.consent.grant': 'ให้ความยินยอม',
  'capture.consent.notNow': 'ไม่ใช่ตอนนี้',
  'capture.consent.changeLater': 'เปลี่ยนได้ทุกเมื่อที่ บัญชี › จัดการความยินยอม',
  // Unit labels (display only — not user-typed)
  'capture.unit.kg': 'กก.',
  'capture.unit.mmHg': 'mmHg',

  // ── Quick Capture — Medication family (capture-ui §3.1 + medication-behavior §B) ─
  // Plan name / dose are VERBATIM (never translated, never parsed — INV-M4).
  // taken / missed get EQUAL weight — missed is NEVER amber/shaming (INV-M2 / AC-20).
  'capture.type.medication': 'ยา',
  'capture.medication.takenLabel': 'กินแล้ว',
  'capture.medication.missedLabel': 'ไม่ได้กิน',
  'capture.medication.planFromLabel': 'จากแผนยา',
  'capture.medication.doseLabel': 'ขนาด',
  'capture.medication.statusLabel': 'สถานะ',

  // ── Snooze chooser (Task 5 — medication-only 10/30/60 picker) ────────────────
  // Keys per functional-spec §2.4 + screens-spec §5.4 (design Task 0d finalized).
  // Used by SnoozeChooserSheet and the CalendarScreen snooze path.
  // Thai copy is DRAFT pending licensed lawyer review before launch.
  'reminder.snooze.title': 'เลื่อนเตือน',
  /** template: {time} = computed re-alert time "HH:mm" — visible sub-label */
  'reminder.snooze.alertsAt': 'จะแจ้งเตือนเวลา {time}',
  /**
   * SR-only a11y label for the re-alert time — screens-spec §5.3/§5.6.
   * Includes "อีกครั้ง" (again) to match spec. NOT used for visible text.
   * template: {time} = "HH:mm"
   */
  'reminder.snooze.alertsAt.sr': 'จะแจ้งเตือนอีกครั้งเวลา {time}',
  'reminder.snooze.opt.10': '10 นาที',
  'reminder.snooze.opt.30': '30 นาที',
  'reminder.snooze.opt.60': '60 นาที',
  'reminder.snooze.cancel': 'ยกเลิก',
  /** template: {time} = snoozedUntil "HH:mm" shown in occurrence row sub-label */
  'reminder.snoozedUntil': 'เลื่อนไปเวลา {time}',

  // ── Notification strings — medication reminder (design §5.4, SD-11) ──────────
  // These keys are the single source of truth for the generic lock-screen copy
  // (screens-spec §5.4 / ADR Decision 4). NEVER include drug name/dose here.
  // NOTE: The notificationScheduler.ts MEDICATION_TITLE_TH constant uses the
  //       same string value ('ถึงเวลากินยา') — they MUST stay in sync.
  //       The scheduler cannot use useT() (it is a pure function outside React)
  //       so the constant is kept alongside this catalog entry for alignment.
  //       "ถึงเวลาทานยา" (the older calendar-spec wording) is RECONCILED here
  //       to the owner-decided "ถึงเวลากินยา" (design §3 OQ-MR-2).
  'notification.medication.title': 'ถึงเวลากินยา',
  'notification.medication.body': 'แตะเพื่อดู',
  'notification.action.markDone': 'กินแล้ว ✓',
  'notification.action.snooze': 'เลื่อนเตือน',

  // ── Medication Plans (medication-plan-ui.md §9) ──────────────────────────────
  // Navigation / tab
  'medication.navTitle': 'แผนยา',
  'medication.tabLabel': 'ยา',
  // Empty state
  'medication.emptyHeadline': 'ยังไม่มีแผนยา',
  'medication.emptyBody': 'เพิ่มยาที่ต้องกิน แล้วเราจะเตือนตามตาราง',
  'medication.addFirst': '+ เพิ่มแผนยาแรก',
  // Form titles
  'medication.addTitle': 'เพิ่มแผนยา',
  'medication.editTitle': 'แก้ไขแผนยา',
  // Field labels
  'medication.fieldName': 'ชื่อยา (จำเป็น)',
  'medication.fieldDose': 'ขนาดยา (ไม่บังคับ)',
  'medication.fieldSchedule': 'ตารางการกิน',
  // Schedule chip labels (3 chips)
  'medication.scheduleChip.daily': 'ทุกวัน',
  'medication.scheduleChip.every_n_days': 'ทุก N วัน',
  'medication.scheduleChip.one_off': 'ครั้งเดียว',
  // Time-of-day sub-fields
  'medication.fieldTimesOfDay': 'เวลาที่กิน',
  'medication.addTime': '+ เพิ่มเวลา',
  'medication.fieldInterval': 'กินทุกกี่วัน',
  'medication.fieldStartDate': 'เริ่มตั้งแต่',
  // Active toggle
  'medication.fieldActive': 'ใช้งานอยู่',
  'medication.activeSubLabelOn': 'กำลังสร้างการแจ้งเตือน',
  'medication.activeSubLabelOff': 'หยุดสร้างการแจ้งเตือนใหม่ · ประวัติการกินยายังอยู่',
  // Echo / preview
  'medication.echoPrefix': 'จะแสดงในปฏิทินเป็น:',
  // Actions
  'medication.save': 'บันทึก',
  'medication.add': '+ เพิ่มแผนยา',
  'medication.deactivate': 'ปิดแผนยา',
  'medication.reactivate': 'เปิดแผนยา',
  'medication.delete': 'ลบแผนยา',
  // List divider
  'medication.pausedDivider': 'หยุดพักชั่วคราว',
  'medication.inactiveTag': 'ปิดใช้งาน',
  // Privacy / encryption notice
  'medication.encryptionNotice': 'เข้ารหัสในเครื่อง',
  'medication.privacyLine': 'เก็บไว้ในเครื่อง · ไม่ถูกอ่านหรือวิเคราะห์',
  // Toast messages
  'medication.deactivateToast': 'ปิดแผนยาแล้ว · ประวัติยังอยู่',
  'medication.deleteToast': 'ลบแผนยาแล้ว',
  'medication.saveToast': 'บันทึกแล้ว',
  'medication.savedLocalOnly': 'บันทึกในเครื่องแล้ว (ยังไม่ได้ซิงค์)',
  // Validation errors (typo-guard tone — never clinical)
  'medication.errorNameRequired': 'ใส่ชื่อยา',
  'medication.errorTimeRequired': 'เลือกเวลาสักหนึ่งเวลา',
  'medication.errorIntervalMin': 'ต้องเป็น 2 วันขึ้นไป',
  // Generic errors
  'medication.saveError': 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
  'medication.loadError': 'เปิดข้อมูลในเครื่องไม่สำเร็จ',
  // Consent nudge (general_health gate — warm, non-shaming)
  'medication.consentNudgeTitle': 'ต้องให้ความยินยอมบันทึกสุขภาพก่อน',
  'medication.consentNudgeAction': 'เปิดสิทธิ์',
  // Delete confirm panel (2-step, inside sheet)
  'medication.deleteConfirmTitle': 'ลบแผนยา {name} ?',
  'medication.deleteConfirmBody1': 'แผนยานี้จะหายไปจากรายการ และหยุดสร้างการแจ้งเตือนใหม่',
  'medication.deleteConfirmBody2': 'ประวัติการกินยาของคุณ (ที่บันทึกไว้แล้ว) ยังคงอยู่',
  'medication.deleteConfirmOk': 'ยืนยันลบ',
  'medication.deleteConfirmCancel': 'ยกเลิก',
  // Offline pill
  'medication.offlinePill': 'ออฟไลน์ · บันทึกไว้ในเครื่อง',
  // a11y / M3: i18n for previously hardcoded Thai labels
  'medication.removeTime': 'ลบ',
  'medication.confirmPicker': 'ยืนยัน',
  'medication.timeField': 'เวลา',
  // Error state (B5)
  'medication.dataStillHere': 'ข้อมูลของคุณยังอยู่',
  'medication.loadingSkeleton': 'กำลังโหลดแผนยา',
  // Consent banner (B4)
  'medication.consentBannerAction': 'เปิดสิทธิ์บันทึกสุขภาพ ›',
  // Echo preview (F1)
  'medication.echoAndMore': 'และอื่นๆ',
  'medication.echoPlanned': 'วางแผนไว้',
  // Deactivate/Delete sub-copy (F4)
  'medication.deactivateSubCopy1': 'หยุดพักชั่วคราว — ไม่สร้างการแจ้งเตือนใหม่',
  'medication.deactivateSubCopy2': 'ประวัติการกินยาของคุณยังอยู่ครบ',
  'medication.deleteSubCopy1': 'นำออกจากรายการนี้',
  'medication.deleteSubCopy2': 'ประวัติการกินยา (ที่บันทึกไว้แล้ว) ยังคงอยู่',
  // Save button disabled (F6)
  'medication.saveDisabledConsentLabel': 'เปิดสิทธิ์บันทึกสุขภาพเพื่อบันทึก',
  // Echo placeholder — shown when name is empty (§5.5 design #1)
  'medication.echoPlaceholder': 'ชื่อยา... · เวลา...',
  // PRN label — schedule-preview when plan has no schedule (§design #2)
  'medication.prnLabel': 'PRN',
  // Log a dose — quiet affordance on each active plan row (Task 11)
  'medication.logDose': 'บันทึกการกินยา',

  // ── Account Rights (account-rights-ui.md §4) ──────────────────────────────────
  // S7 Settings rows (§4.1)
  'accountRights.downloadLabel': 'ดาวน์โหลดข้อมูลของฉัน',
  'accountRights.downloadSubtitle': 'PDPA ม.30/31',
  'accountRights.deleteLabel': 'ลบบัญชีของฉัน',
  'accountRights.deleteSubtitle': 'การลบเป็นการถาวร',
  // Export states (§4.2)
  'accountRights.export.inProgress': 'กำลังเตรียมไฟล์ข้อมูล...',
  'accountRights.export.errorTitle': 'ดาวน์โหลดไม่สำเร็จ',
  'accountRights.export.errorBody': 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่',
  'accountRights.export.retry': 'ลองใหม่',
  'accountRights.export.dismiss': 'ปิด',
  'accountRights.export.notAvailableTitle': 'ข้อมูลนี้ไม่สามารถเข้าถึงได้อีกต่อไป',
  'accountRights.export.backToSettings': 'กลับ',
  // Delete confirm sheet — title (§4.3)
  'accountRights.delete.sheetTitle': 'ลบบัญชีของคุณ',
  // Disclosure bullets — VERBATIM from 0e §5d item 3; NO retention number (D7/M-1)
  // CANONICAL STRING — identical across all sheet states (AR-5..9). See UI spec §4.3 note M-1.
  'accountRights.delete.disclosure1': 'เมื่อคุณยืนยัน บัญชีจะถูกปิดใช้งานทันที — คุณจะออกจากระบบบนเครื่องนี้ และจะเข้าสู่ระบบอีกไม่ได้ทุกอุปกรณ์',
  'accountRights.delete.disclosure2': 'ข้อมูลของคุณจะถูกลบออกจากระบบอย่างถาวรหลังจากช่วงดำเนินการหนึ่ง ตามนโยบายการเก็บรักษาข้อมูลของเรา',
  'accountRights.delete.disclosure3': 'การลบนี้ยกเลิกในแอปไม่ได้ และไม่มีการกู้คืนบัญชี',
  // Export-before-delete nudge (verbatim from 0e §5d item 3)
  'accountRights.delete.nudgeTitle': 'อยากเก็บสำเนาข้อมูลไว้ก่อนไหม?',
  'accountRights.delete.nudgeBody': 'หลังจากลบบัญชีแล้ว คุณจะดาวน์โหลดข้อมูลไม่ได้อีก ถ้าต้องการเก็บไว้ ดาวน์โหลดก่อนได้เลย',
  'accountRights.delete.nudgeDownloadBtn': 'ดาวน์โหลดข้อมูลก่อน',
  'accountRights.delete.nudgeSkipBtn': 'ข้ามไป ลบต่อ',
  // Type-to-confirm (§4.3, §3.7)
  'accountRights.delete.confirmLabel': 'พิมพ์ "ลบ" เพื่อยืนยัน',
  // confirmWord key REMOVED (was dead — never read by code). Single source of truth
  // for the confirm word is CONFIRM_WORDS in confirmWordMatch.ts. (#9)
  // confirmPlaceholder key REMOVED — placeholder is now derived from CONFIRM_WORDS[locale].
  // Buttons (§4.3)
  'accountRights.delete.confirmBtn': 'ยืนยันลบบัญชี',
  'accountRights.delete.cancelBtn': 'ยกเลิก',
  'accountRights.delete.retryBtn': 'ลองใหม่',
  'accountRights.delete.biometricPrompt': 'ยืนยันตัวตนเพื่อลบบัญชี',
  'accountRights.delete.biometricCancel': 'ยกเลิก',
  // Biometric degrade notice (§4.3 — warm amber, NOT alarming red)
  'accountRights.delete.degradeNotice': 'ยืนยันด้วยลายนิ้วมือ/ใบหน้าใช้ไม่ได้ชั่วคราว — จะใช้การพิมพ์คำยืนยันแทน แตะยกเลิกแล้วลองใหม่เพื่อยืนยันด้วยลายนิ้วมือ/ใบหน้า',
  // Delete error (§4.3 — reassurance first; stays signed in)
  'accountRights.delete.errorTitle': 'ลบบัญชีไม่สำเร็จ',
  'accountRights.delete.errorBody': 'ตรวจสอบการเชื่อมต่อแล้วลองใหม่ บัญชีของคุณยังคงอยู่',

  // ── Bottom-tab navigation v2 (bottom-tab-navigation-design.md v2.1 §1.1, §8.2) ─
  // Tab order: Supplies · Expenses · Home (center) · Calendar · Medication
  // Doctor Report removed from tab bar (now accessed from Home tab row → root stack)
  // Visible tab labels — short, lifecycle-neutral
  'tab.supplies': 'ของใช้',          // v2: changed from 'เตรียม' per OQ-NAV-5 (lifecycle-neutral)
  'tab.expenses': 'ค่าใช้จ่าย',
  'tab.home': 'หน้าหลัก',            // v2 CENTER tab — dashboard + settings + report entry
  'tab.calendar': 'ปฏิทิน',          // v2: grid-only (no dashboard above it)
  'tab.medication': 'ยา',
  // v3: 6th tab — Profile (profile-tab-and-hub-ui.md v1.1 §6.1, §13.1)
  'tab.profile': 'โปรไฟล์',
  /** Short-label fallback for 12pt-clipping scenario — §2.2 decision tree only */
  'tab.profile.short': 'ฉัน',
  // Accessibility labels — full names for screen readers (spec §8.2)
  'tab.supplies.a11y': 'รายการของใช้สำหรับคุณแม่',   // v2: updated per OQ-NAV-5
  'tab.expenses.a11y': 'ค่าใช้จ่าย',
  'tab.home.a11y': 'หน้าหลักและข้อมูลการตั้งครรภ์',  // v2 center tab (§8.2)
  'tab.calendar.a11y': 'ปฏิทิน',                      // v2: simplified (grid-only)
  'tab.medication.a11y': 'แผนการใช้ยา',
  // v3: Profile tab a11y (§7.1, §7.4 — full form, always used regardless of visible label)
  'tab.profile.a11y': 'โปรไฟล์และบัญชี',
  // Doctor Report entry row in Home tab scroll (spec §3.3)
  'home.doctorReport': 'รายงานสำหรับแพทย์ ›',
  // Feeding-log entry row in Home tab (Bug #4 — moved from Supplies tab).
  // Neutral verb only (FW-1) — no brand/product/promo copy.
  'home.feedingLog': 'บันทึกการให้นม ›',
  // Kick-count card (pregnant wk≥32, spec §4.2) — warm & inviting, not clinical
  'kick.countCard': 'ได้เวลานับลูกดิ้นแล้ว ›',

  // ── Mother's Room re-skin (mother-room-build-spec.md §4.1) ──────────────────
  // Greeting bar (§4.1 flat header)
  'home.greeting': 'สวัสดี คุณแม่',
  // Week hero zone tap affordance (a11y label suffix; §4.2)
  'home.tapForMilestone': 'แตะเพื่อดูข้อมูลสัปดาห์',
  // Amber CTA labels (§4.1 state matrix)
  'home.captureToday': 'เพิ่มการบันทึกวันนี้',
  // §4.1 Loss-state CTA text change
  'home.captureFeeling': 'บันทึกความรู้สึกวันนี้',
  // Kick-count today label (AccentRow value; §4.1 data list)
  'home.kickCountToday': 'วันนี้',

  // ── WeeklyMilestoneSheet (§4.2) ───────────────────────────────────────────────
  'milestone.close': '← ปิด',
  'milestone.closeSheet': 'ปิดแผ่นข้อมูลสัปดาห์',
  'milestone.babySection': 'ลูกของคุณ',
  'milestone.maternitySection': 'ร่างกายของคุณแม่',
  'milestone.tipSection': 'เคล็ดลับ',
  'milestone.journalCta': 'เขียนบันทึกวันนี้',
  'milestone.empty': 'ยังไม่มีข้อมูลสำหรับสัปดาห์นี้',

  // ── Baby Size Comparison — Home Section (baby-size-home-section.md) ───────────
  // Design §7.7 — new i18n keys. Fruit names live in babySizeData.ts (static table).
  // S2 invariant: NO health-status words (ปกติ/ผิดปกติ/สุขภาพดี/สมส่วน/ตามเกณฑ์) here.
  // S6/S7 invariant: these strings MUST NOT be used in ad/product/feeding paths.
  'home.babySizeSectionLabel': 'ขนาดลูกน้อย',
  'home.babyYourBabySectionLabel': 'ลูกน้อยของคุณ',
  /** template: {length} = numeric cm value (without ~). Component adds ~. */
  'home.babySizeSizeInfo': 'ยาวประมาณ ~{length} ซม. · ~{weight}',
  /** wks 5–7: weight omitted (legal S2 — <1g reads clinical) */
  'home.babySizeSizeInfoLengthOnly': 'ยาวประมาณ ~{length} ซม.',
  /** Postpartum warm note — no medical claims, no milestone references */
  'home.babyWarmNote': 'แต่ละวันที่เติบโตคือของขวัญ',
  /**
   * Pregnant short-form disclaimer — VERBATIM from legal §4 short-form.
   * Always-on in the pregnant variant (S5). Color #5F4A52, 13pt.
   * DO NOT paraphrase. DO NOT reduce to < 13pt.
   */
  'home.babySizeDisclaimer': 'ค่าเฉลี่ยโดยประมาณ · เพื่อข้อมูลทั่วไป ไม่ใช่คำแนะนำทางการแพทย์ · ทารกแต่ละคนต่างกัน',
  /**
   * Pregnant full-form disclaimer — VERBATIM from legal §4 full-form.
   * Shown in modal opened by "ดูเพิ่มเติม". G-size-1 launch-gate applies.
   */
  'home.babySizeFullDisclaimer': 'ขนาดและน้ำหนักที่แสดงเป็น ค่าเฉลี่ยโดยประมาณ ตามช่วงอายุครรภ์ เพื่อเป็นข้อมูลทั่วไปและความเพลิดเพลินในการติดตามพัฒนาการเท่านั้น ไม่ใช่การวินิจฉัยหรือคำแนะนำทางการแพทย์ ทารกแต่ละคนเติบโตแตกต่างกันได้ตามปกติ หากมีข้อสงสัยหรือกังวลเกี่ยวกับครรภ์หรือลูกน้อย โปรดปรึกษาแพทย์หรือผู้ให้บริการด้านสุขภาพของคุณ',
  /**
   * Postpartum disclaimer — VERBATIM from legal §4 ฉบับหลังคลอด.
   * Always-on in the postpartum variant (S5). Same text for inline + modal.
   * Milk Code highest-risk element per legal §2 CR-1. DO NOT abbreviate.
   */
  'home.babyPostpartumDisclaimer': 'อายุของลูกคำนวณจากวันเกิดที่คุณบันทึก เพื่อเป็นข้อมูลทั่วไป ไม่ใช่การประเมินพัฒนาการหรือคำแนะนำทางการแพทย์ พัฒนาการของเด็กแต่ละคนแตกต่างกันได้ หากมีข้อกังวล โปรดปรึกษาแพทย์หรือผู้ให้บริการด้านสุขภาพ',
  /** "ดูเพิ่มเติม" link — opens full-form disclaimer modal (≥44dp tap target) */
  'home.babySizeDisclaimerLink': 'ดูเพิ่มเติม',
  'home.babySizeDisclaimerModalTitle': 'ข้อมูลสำคัญ',
  /**
   * Source ribbon — pregnant variant only (size numbers). Postpartum has no numbers.
   * G-size-2 research pass: source = BabyCenter Fetal Growth Chart.
   * [source/year to confirm before prod: research pass = BabyCenter Fetal Growth Chart; year 2024 pending confirmation on the cited page]
   */
  'home.babySizeSourceRibbon': 'ข้อมูลอ้างอิงโดยประมาณ: BabyCenter Fetal Growth Chart, 2024',

  // ── Auth: Forgot Password (S5) ───────────────────────────────────────────────
  // NON-ENUMERATION (§E/C7 SEC-INV-1): confirmBody MUST NOT contain 'บัญชี'
  // to avoid hinting whether the email has an account (unit-tested in messages.test.ts
  // and forgotPasswordScreenLogic.test.ts).
  'forgot.navTitle': 'ลืมรหัสผ่าน',
  'forgot.title': 'ลืมรหัสผ่าน',
  'forgot.subtitle': 'กรอกอีเมลของคุณ แล้วเราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้',
  'forgot.emailLabel': 'อีเมล',
  'forgot.emailPlaceholder': 'you@example.com',
  'forgot.emailHint': 'ตรวจอีเมลอีกครั้งนะคะ',
  'forgot.submit': 'ส่งลิงก์รีเซ็ต',
  'forgot.confirmTitle': 'ตรวจกล่องอีเมลของคุณ',
  /**
   * SEC-INV-1 NON-ENUMERATING: must NOT contain 'บัญชี' (subsumes ไม่พบบัญชี/ไม่มีบัญชี/มีบัญชี).
   * Enforced by test: forgot.confirmBody (th) not.toContain('บัญชี').
   */
  'forgot.confirmBody': 'เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณแล้ว โปรดตรวจกล่องอีเมล (รวมถึงโฟลเดอร์สแปม)',
  'forgot.resend': 'ส่งลิงก์อีกครั้ง',
  'forgot.backToLogin': 'กลับไปหน้าเข้าสู่ระบบ',
  'forgot.rateLimited': 'ส่งบ่อยเกินไป · ลองใหม่ภายหลัง',
  'forgot.offline': 'คุณออฟไลน์อยู่',
  'forgot.serverError': 'มีบางอย่างผิดพลาดทางฝั่งเรา · ลองอีกครั้ง',

  // ── Auth: Reset Password ──────────────────────────────────────────────────────
  // SEC-INV-2: tokenInvalid is ONE generic message — never explains wrong/expired/used.
  // SEC-INV-6: 422/429/network/server_error keep the user on screen with the same token.
  'reset.navTitle': 'ตั้งรหัสผ่านใหม่',
  'reset.title': 'ตั้งรหัสผ่านใหม่',
  'reset.newPasswordLabel': 'รหัสผ่านใหม่',
  'reset.confirmLabel': 'ยืนยันรหัสผ่านใหม่',
  'reset.passwordHint': 'อย่างน้อย 8 ตัวอักษร',
  /** SEC-INV-4: shown pre-submit so the logged-out-everywhere outcome is not a surprise. */
  'reset.revokeNotice': 'เมื่อตั้งรหัสใหม่ คุณจะถูกออกจากระบบทุกอุปกรณ์ และต้องเข้าสู่ระบบใหม่',
  'reset.submit': 'บันทึกรหัสผ่านใหม่',
  'reset.successToast': 'ตั้งรหัสใหม่สำเร็จ · เข้าสู่ระบบด้วยรหัสใหม่',
  /** SEC-INV-2: one generic message — never distinguishes wrong/expired/used. */
  'reset.tokenInvalid': 'ลิงก์นี้ใช้ไม่ได้หรือหมดอายุ — ขอลิงก์ใหม่อีกครั้ง',
  'reset.requestNewLink': 'ขอลิงก์ใหม่',
  'reset.linkMissing': 'ลิงก์ไม่ถูกต้อง — ขอลิงก์ใหม่อีกครั้ง',
  'reset.passwordTooShort': 'รหัสผ่านสั้นเกินไป · อย่างน้อย 8 ตัวอักษร',
  'reset.passwordBreached': 'รหัสผ่านนี้ไม่ปลอดภัย · ลองรหัสอื่น',
  'reset.mismatch': 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
  'reset.rateLimited': 'ลองใหม่ภายหลัง',
  'reset.offline': 'คุณออฟไลน์อยู่',
  'reset.serverError': 'มีบางอย่างผิดพลาดทางฝั่งเรา · ลองอีกครั้ง',

  // ── Pregnancy Summary Screen ──────────────────────────────────────────────────
  // ProfileHub row — lifecycle-agnostic (pregnant + postpartum, §3.2 product spec)
  'pregnancySummary.rowLabel': 'สรุปการตั้งครรภ์',
  'pregnancySummary.rowSubtitle': 'ดูย้อนหลังตามไตรมาส',

  // Screen navigation
  'pregnancySummary.navTitle': 'สรุปการตั้งครรภ์',

  // Trimester section headers
  // G-PS-d: each trimester is a separate fact — no cross-trimester arrows/trend copy.
  'pregnancySummary.t1': 'ไตรมาสที่ 1',
  'pregnancySummary.t2': 'ไตรมาสที่ 2',
  'pregnancySummary.t3': 'ไตรมาสที่ 3',

  // Kicks section
  // G-PS-b (INV-PS1): no verdict/badge/color.
  // G-PS-c: "จาก {days} วันที่บันทึก" must appear adjacent to avg — always-on.
  // K-8: movementCount / sums / avg must NOT egress to logs or analytics.
  'pregnancySummary.kicks.sectionLabel': 'ลูกดิ้น',
  /** template: {avg} = formatted avg kicks/day (e.g. "12.5") */
  'pregnancySummary.kicks.avgPerDay': 'เฉลี่ย {avg} ครั้ง/วัน',
  /** template: {days} = number of distinct calendar days with data */
  'pregnancySummary.kicks.daysWithData': 'จาก {days} วันที่บันทึก',
  'pregnancySummary.kicks.noData': 'ยังไม่มีข้อมูล',

  // Medication section
  'pregnancySummary.meds.sectionLabel': 'ยา',
  /** template: {days} = distinct calendar days on which this medication was logged */
  'pregnancySummary.meds.distinctDays': '{days} วันที่บันทึก',
  'pregnancySummary.meds.noData': 'ยังไม่มีข้อมูล',

  // Delivery section
  'pregnancySummary.delivery.sectionLabel': 'การคลอด',
  'pregnancySummary.delivery.typeLabel': 'วิธีคลอด',
  'pregnancySummary.delivery.admissionLabel': 'วันแอดมิต',
  'pregnancySummary.delivery.dischargeLabel': 'วันจำหน่าย',
  'pregnancySummary.delivery.noData': 'ยังไม่มีข้อมูลการคลอด',
  'pregnancySummary.delivery.notSpecified': 'ยังไม่ได้ระบุ',

  // Screen states
  'pregnancySummary.noEddPrompt': 'ยังไม่ได้ตั้งวันกำหนดคลอด',
  'pregnancySummary.noEddAction': 'ตั้งค่าวันกำหนดคลอด',
  'pregnancySummary.partialNote': 'กำลังตั้งครรภ์ · ข้อมูลบางส่วนอาจยังไม่ครบ',

  // Disclaimer — VERBATIM (legal §3 G-summary-1; DO NOT paraphrase or auto-translate).
  // Short form: always-on inline at top of screen.
  // Full form: tappable link ≥ 44dp (link must NOT be inside accessibilityRole="text" parent).
  // G-PS-a: both forms must be present. G-PS-b: disclaimer is exempt from denylist.
  'pregnancySummary.disclaimer.short':
    'ข้อมูลที่คุณบันทึกไว้เอง เพื่อการทบทวน · ไม่ใช่การประเมินหรือคำแนะนำทางการแพทย์',
  'pregnancySummary.disclaimer.seeMore': 'ดูเพิ่มเติม',
  'pregnancySummary.disclaimer.full':
    'ข้อมูลในหน้านี้เป็นสิ่งที่คุณบันทึกไว้เอง นำมารวบรวมและจัดกลุ่มตามช่วงการตั้งครรภ์เพื่อให้คุณย้อนทบทวน ไม่ใช่การประเมิน การวินิจฉัย หรือคำแนะนำทางการแพทย์ หากมีข้อสงสัยหรือกังวลเกี่ยวกับสุขภาพของคุณหรือลูกน้อย โปรดปรึกษาแพทย์หรือผู้ให้บริการด้านสุขภาพของคุณ',

  // Hospital-stay fields in BirthEventScreen
  // Design: pregnancy-summary-design.md §1.3 — optional, client-validated.
  // OQ-PS4: warn (not block) if admission is far from birthDate.
  'birth.fieldHospitalStaySection': 'การนอนโรงพยาบาล (ไม่บังคับ)',
  'birth.fieldHospitalAdmission': 'วันแอดมิต (ไม่บังคับ)',
  'birth.fieldHospitalDischarge': 'วันจำหน่าย (ไม่บังคับ)',
  'birth.hospitalAdmissionPlaceholder': 'เลือกวันที่ (ไม่บังคับ)',
  'birth.hospitalDischargePlaceholder': 'เลือกวันที่ (ไม่บังคับ)',
  'birth.hospitalAdmissionModalTitle': 'เลือกวันแอดมิต',
  'birth.hospitalDischargeModalTitle': 'เลือกวันจำหน่าย',
  'birth.hospitalAdmissionModalHint': 'กรอกในรูปแบบ YYYY-MM-DD เช่น 2026-06-29',
  'birth.hospitalDischargeModalHint': 'กรอกในรูปแบบ YYYY-MM-DD เช่น 2026-06-29',
  /** OQ-PS4 warn-not-block: admission date is far from birthDate */
  'birth.warnAdmissionFarFromBirthTitle': 'ตรวจสอบวันที่',
  'birth.warnAdmissionFarFromBirthMsg': 'วันแอดมิตห่างจากวันคลอดมาก — ต้องการใช้วันที่นี้ต่อไหมคะ?',
  'birth.warnFarContinue': 'ใช้ต่อ',
  'birth.warnFarCancel': 'ยกเลิก',
  /** Client validation: discharge must be ≥ admission */
  'birth.errorDischargeBeforeAdmission': 'วันจำหน่ายต้องไม่ก่อนวันแอดมิต',
  /** Client validation: hospital date must be ≤ today */
  'birth.errorHospitalDateFuture': 'วันที่ที่เลือกยังมาไม่ถึง',

  // ─── Pregnancy-loss recording (write path) — Z-19 COPY GATE ─────────────────
  // COPY NOT FINAL. These are placeholder/tone-appropriate strings only —
  // final th+en wording is a clinical+legal sign-off gate (functional-spec §11,
  // LOSS-INV-12). Do NOT treat any string below as shippable to production
  // without that sign-off. Tone constraints per functional-spec §11 table are
  // noted inline; forbidden: celebratory glyphs/animation/emoji, positive-affect
  // color, countdown language, minimizing phrases, cause/blame words, clinical/
  // diagnostic terms, assumed-feeling statements.
  'loss.navTitle': 'บันทึกการสิ้นสุดการตั้งครรภ์',
  // Screen A — entry link (neutral, no clinical term, no celebration, no urgency)
  'loss.entry.link': 'การตั้งครรภ์นี้สิ้นสุดแล้ว',
  // Screen B — confirmation
  'loss.confirm.title': 'บันทึกการสิ้นสุดการตั้งครรภ์',
  'loss.confirm.body': 'เมื่อบันทึกแล้ว แอปจะหยุดแสดงเนื้อหาความคืบหน้าของการตั้งครรภ์นี้ ข้อมูลที่คุณบันทึกไว้ก่อนหน้ายังคงอยู่ครบ',
  'loss.confirm.dateLabel': 'วันที่ (ไม่บังคับ)',
  'loss.confirm.dateSkipHint': 'เว้นว่างไว้ได้ ไม่จำเป็นต้องระบุ',
  'loss.confirm.datePlaceholder': 'เลือกวันที่ (ไม่บังคับ)',
  'loss.confirm.primaryBack': 'กลับ',
  'loss.confirm.quietConfirm': 'ยืนยัน: บันทึกการสิ้นสุดการตั้งครรภ์นี้',
  'loss.confirm.disclaimer': 'ข้อมูลนี้บันทึกโดยคุณเอง ไม่ใช่เอกสารทางการแพทย์',
  'loss.confirm.submitting': 'กำลังบันทึก',
  'loss.confirm.dateRangeHint': 'วันที่นี้อยู่นอกช่วงที่บันทึกได้ · เว้นว่างได้',
  'loss.confirm.dateMalformedHint': 'ลองตรวจสอบรูปแบบวันที่อีกครั้ง (YYYY-MM-DD)',
  'loss.result.quietAck': 'บันทึกแล้ว',
  // Errors — Screen B
  'loss.error.consentRequired': 'การบันทึกต้องเปิดสิทธิ์ "บันทึกสุขภาพในเครื่อง" ก่อน',
  'loss.error.conflict': 'มีการเปลี่ยนแปลงจากอุปกรณ์อื่น ระบบได้ปรับข้อมูลให้เป็นปัจจุบันแล้ว',
  'loss.error.goToConsent': 'ไปที่การตั้งค่าความยินยอม',
  'loss.error.offlineQueued': 'ออฟไลน์ · ยังไม่ได้บันทึก · จะลองใหม่เมื่อออนไลน์',
  // Screen C — reopen (neutral, no blame, no "are you sure you gave up?" framing)
  'loss.reopen.entry': 'แก้ไขการบันทึกนี้',
  'loss.reopen.confirm.title': 'กลับสู่การติดตามการตั้งครรภ์',
  'loss.reopen.confirm.body': 'การบันทึกนี้จะถูกแก้ไข และแอปจะกลับมาแสดงเนื้อหาความคืบหน้าของการตั้งครรภ์อีกครั้ง',
  'loss.reopen.confirm.quietConfirm': 'ยืนยัน: แก้ไขและกลับสู่การติดตาม',
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
  'welcome.tagline': 'Your pink handbook for every moment of your pregnancy',
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
  'picker.selectMonth': 'Select month',

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
  'home.errorHeadline': 'Could not load your data',
  'home.errorSubline': 'Your data is still on this device',
  'home.logout': 'Sign out',
  'home.logoutTitle': 'Sign out',
  'home.logoutMessage': 'Are you sure you want to sign out?',
  'home.logoutCancel': 'Cancel',
  'home.logoutConfirm': 'Sign out',
  'home.settingsA11y': 'Settings',
  'settings.title': 'Settings',
  /** Navigation-row label used in Profile Hub → opens SettingsScreen (§2 feat-profile-header-settings-row). */
  'settings.navTitle': 'การตั้งค่า / Settings',
  'settings.account': 'Account',
  'settings.privacy': 'Privacy & Permissions',
  // ── General section (language, app preferences) ───────────────────────────────
  'settings.general': 'General',
  'settings.language': 'Language',
  'settings.languageValueTh': 'ไทย',
  'settings.languageValueEn': 'English',
  // ── Edit pregnancy (settings section) ────────────────────────────────────────
  'settings.pregnancy': 'Pregnancy',
  'settings.editPregnancy': 'Edit pregnancy profile',
  'settings.editPregnancySubtitle': 'Due date / gestational age',

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
  // ── Edit pregnancy profile (edit host screen strings) ─────────────────────────
  'profile.editNavTitle': 'Edit pregnancy profile',
  'profile.editLoading': 'Loading pregnancy profile...',
  'profile.editLoadError': 'Could not load profile — try again',
  'profile.editLoadRetry': 'Try again',
  'profile.editNotFound': 'No pregnancy profile found',
  'profile.editNotEditable': 'Cannot edit at this stage',
  'profile.editConflictReloaded': "Updated on another device — we've loaded the latest. Please review and save again.",
  'profile.editDiscardTitle': 'Discard changes?',
  'profile.editDiscardBody': 'Unsaved changes will be lost',
  'profile.editDiscardCancel': 'Keep editing',
  'profile.editDiscardConfirm': 'Discard',

  // ── Profile Hub screen (profile-tab-and-hub-ui.md v1.1 §13.1) ────────────────
  /** Inline header bar title — bilingual fixed label (§1 feat-profile-header-settings-row). */
  'profile.title': 'โปรไฟล์ / Profile',
  'profile.section.profile': 'Profile',
  'profile.section.accountData': 'Account & Data',
  'profile.section.account': 'Account',
  'profile.loading': 'Loading profile',
  // Summary card fallback name — shown when no name is entered
  // Owner override (2026-07): English mode uses English (overrides §13.1 Thai-first note)
  'profile.summary.fallbackName': 'Mom',
  // Summary card lifecycle badge texts
  'profile.summary.badgePregnant': 'Pregnant',
  'profile.summary.badgePostpartum': 'Postpartum',
  // Summary card — postpartum day count; {n} = postpartumDays
  'profile.summary.postpartumDays': '{n} days postpartum',
  // Summary card — postpartum fallback when birthDate is absent
  'profile.summary.postpartumFallback': 'Postpartum',
  'profile.editPregnancy.subtitle': 'Edit EDD and pregnancy details',
  'profile.downloadData.label': 'Download my data',
  'profile.downloadData.subtitle': 'Article 30',
  'profile.deleteAccount.label': 'Delete my account',
  'profile.deleteAccount.subtitle': 'Permanent, cannot be undone',
  'profile.logout.message': 'This will clear all data on this device',

  // ── ProfileInfoEdit row in ProfileHub ────────────────────────────────────────
  'profile.infoEdit.rowLabel': 'Edit name / Personal info',
  'profile.infoEdit.rowSubtitle': "Mother's name and baby's name",

  // Summary card mother first-name display — {name} replaced with decoded motherFirstName
  // Owner override (2026-07): English mode uses English (overrides §13.1 Thai-first note)
  'profile.summary.motherFirstName': 'Mom {name}',

  // ── ProfileInfoEditScreen ─────────────────────────────────────────────────────
  'profileInfo.navTitle': 'Edit personal info',
  'profileInfo.subtitle': 'Names are shown only in your app',
  'profileInfo.field.motherFirstName': 'First name (Mother)',
  'profileInfo.field.motherLastName': 'Last name',
  'profileInfo.field.babyName': "Baby's name",
  'profileInfo.field.optional': '(optional)',
  'profileInfo.placeholder.motherFirstName': 'Enter first name',
  'profileInfo.placeholder.motherLastName': 'Enter last name',
  'profileInfo.placeholder.babyName': "Enter baby's name",
  'profileInfo.validation.nameTooLong': 'Name must be 100 characters or fewer',
  'profileInfo.save': 'Save',
  'profileInfo.saving': 'Saving...',
  'profileInfo.saved': 'Saved',
  'profileInfo.error.login': 'Please sign in again',
  'profileInfo.error.conflict': 'Updated on another device — please try again',
  'profileInfo.error.generic': 'Could not save right now',
  'profileInfo.note.optional': 'Optional — names are shown only in your app',

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
  'supplies.autoDecrementSettings': 'Auto-decrement settings ›',
  'supplies.feedingLog': 'Log feeding ›',

  // ── Auto-stock-decrement ───────────────────────────────────────────────────────

  // Screen 1 — Auto-decrement settings
  'autoDecrement.navTitle': 'Auto stock decrement',
  'autoDecrement.backToSupplies': 'Supplies',
  'autoDecrement.loading': 'Loading',
  'autoDecrement.offline': 'Offline · showing local data',

  // Activity section headers (neutral only — FW-1)
  'autoDecrement.activity.diaperChange': 'Diaper change',
  'autoDecrement.activity.formulaFeed': 'Formula feed',  // FW-1: no brand
  'autoDecrement.activity.bathing': 'Bath time',

  // Toggle
  'autoDecrement.toggleOn': 'On',
  'autoDecrement.toggleOff': 'Off',
  'autoDecrement.toggle.a11yLabel': 'Auto-decrement {activityName} {state}',

  // Item-link row
  'autoDecrement.linkItem': '+ Link a supply',
  'autoDecrement.unlinkItem.a11yLabel': 'Unlink {itemName}',

  // Per-use units
  'autoDecrement.unit.piece': 'pieces/use',
  'autoDecrement.unit.meal': 'scoops/feed',   // FW-1 neutral
  'autoDecrement.unit.time': 'uses/use',

  // Advisory states
  'autoDecrement.advisory.packSetupRequired': 'Set up packaging before enabling',
  'autoDecrement.advisory.packSetupCta': 'Set up packaging ›',
  'autoDecrement.advisory.consentRequired': 'Enable when feeding log is consented',
  'autoDecrement.advisory.consentCta': 'Grant permission ›',
  'autoDecrement.advisory.noItemLinked': 'No supply item linked yet',

  // Item picker — "Link an item" destination (Bug #2 fix)
  'supplyItemPicker.navTitle': 'Choose a supply',
  'supplyItemPicker.emptyState': 'No supplies yet — try adding one first.',
  'supplyItemPicker.backA11y': 'Back',

  // Screen 2 — Sub-unit setup
  'subUnitSetup.sectionTitle': 'Auto stock decrement',
  'subUnitSetup.usesPerContainerLabel': 'How many uses does 1 container hold?',
  'subUnitSetup.defaultQtyLabel': 'Default amount per use',
  'subUnitSetup.usesPerContainerError': 'A container must hold at least 1 use',
  'subUnitSetup.echoPreviewLabel': 'Will appear as:',
  'subUnitSetup.echoLine': '{name} 1 container = {p} uses · deduct {q} uses/feed',

  // Steer-to-pack guided conversion (D-4)
  'subUnitSetup.steerToPack.title': 'Switch to counting by pack / container',
  'subUnitSetup.steerToPack.currentQty': 'You currently have: {name} {qty} pieces',
  'subUnitSetup.steerToPack.itemsPerPackLabel': 'How many pieces per pack?',
  'subUnitSetup.steerToPack.echoPreviewLabel': 'Will change to:',
  'subUnitSetup.steerToPack.echoLine': '{name}: 1 pack ({remaining} pieces remaining)',
  'subUnitSetup.steerToPack.confirmBtn': 'Confirm change',
  'subUnitSetup.steerToPack.cancelBtn': 'Cancel',
  'subUnitSetup.steerToPack.itemsPerPackError': 'At least 2 pieces/pack required for auto-decrement',
  'subUnitSetup.itemNotFound': 'Item not found',
  'subUnitSetup.a11y.decrement': 'Decrease count',
  'subUnitSetup.a11y.increment': 'Increase count',

  // Screen 3 — Formula-feed chip (FW-1: no brand)
  'formulaFeed.chip': 'Formula feed',
  'formulaFeed.amountLabel': 'Amount (scoops/feeds)',
  'formulaFeed.amountPlaceholder': '0',
  'formulaFeed.consentGate': 'Enable feeding log first to use this',
  'formulaFeed.submit': 'Save feeding record',

  // FeedingLogScreen (Screen 3 surface)
  'feedingLog.navTitle': 'Log feeding',
  'feedingLog.breastfeed': 'Breastfeed',
  'feedingLog.pump': 'Pump',
  'feedingLog.save': 'Save',
  'feedingLog.saved': 'Saved',
  'feedingLog.close': 'Close',
  'feedingLog.error': 'Could not save. Try again.',
  'feedingLog.retry': 'Try again',
  'feedingLog.consentGate': 'Enable health logging first',
  'feedingLog.consentCta': 'Grant permission ›',

  // Screen 4 — Care-activity tag on reminder form
  'reminder.careActivityType.fieldLabel': 'Care activity type (optional)',
  'reminder.careActivityType.none': 'None',
  'reminder.careActivityType.diaperChange': 'Diaper change',
  'reminder.careActivityType.bathing': 'Bath time',
  'reminder.careActivityType.a11yLabel': 'Care activity type: {value}',

  // Low-supply cue (FW-1: no brand/buy copy)
  'lowSupply.cue.inApp': 'Your formula supply is running low',
  'lowSupply.cue.push.title': 'Item running low',
  'lowSupply.cue.push.body': 'A household supply is running low — please check',
  'lowSupply.restock.push.title': 'Restock reminder',
  'lowSupply.restock.push.body': "It's time to top up your supplies",

  // ── Calendar ──────────────────────────────────────────────────────────────────
  'calendar.navTitle': 'Calendar',
  'calendar.today': 'Today',
  'calendar.empty': 'Nothing scheduled today',
  'calendar.loading': 'Loading',
  'calendar.offline': 'Offline · showing local data',
  'calendar.viewAll': 'View all',
  'calendar.shortcutBtn': 'Calendar & daily log ›',
  'calendar.addAppointment': '+ New appointment',
  'calendar.addReminder': '+ New reminder',
  'calendar.addCapture': '+ Log health',
  'calendar.addAppointment.a11yLabel': 'New appointment',
  'calendar.addReminder.a11yLabel': 'New reminder',
  'calendar.addCapture.a11yLabel': 'Log health',
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
  /** Kick-count agenda row label (feat-kickcount-in-calendar). {count} = movementCount. */
  'calendar.kickCount.label': 'Kick count: {count}',

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
  /** DEF-01 fix: shown in date field when date is blank (ANC_PREFILL_DATE=OFF). */
  'appointment.datePlaceholder': 'Select date',

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
  /** NEW B2 ห้องแม่ — milestone preset templates section label */
  'reminder.milestonePresetsLabel': 'Choose from templates',

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
  'kick.endSessionBtn': 'Done',
  'kick.cancelBtn': 'Cancel',
  'kick.progressA11y': '{n} movements recorded',
  'kick.tapA11y': 'Tap when you feel a movement. {n} movements recorded so far.',
  'kick.endSessionA11y': 'Done counting, save this count',
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
  // Loss-state replacement (lifecycle='ended') — Gate 2 (G2-DELIV)
  'kick.lossReplacement': 'This feature is not available at this time',
  'kick.lossGoBack': 'Back',
  'kick.detailCountLabel': 'Movements',
  'kick.detailDurationLabel': 'Time',
  'kick.detailWeekLabel': 'Gestational age',
  'kick.detailNoteLabel': 'My notes',
  'kick.detailExportPdf': 'Export to doctor PDF',
  'kick.detailWeekValue': 'Week {n}',

  // ── Kick-count history chart + date-range picker (SC-K4 chart feature) ────────
  'kick.chartTitle': 'Daily kicks',
  'kick.chartDateRange': 'Date range',
  'kick.chartFrom': 'From',
  'kick.chartTo': 'To',
  'kick.chart7d': '7 days',
  'kick.chart14d': '14 days',
  'kick.chart30d': '30 days',
  'kick.chartEmpty': 'No data for this period',
  /** template: {n} = number of days, {max} = highest daily total */
  'kick.chartA11y': 'Daily kick count chart, {n} days, max {max} movements',

  // ── Consent (PDPA) ───────────────────────────────────────────────────────────
  // English translations of Thai consent copy (consent-copy.md v1.0 DRAFT).
  // ⚠️ DRAFT: licensed Thai legal counsel must approve before launch (§Z-2).

  // S3 screen chrome
  'consent.screen.title': 'Your health handbook',
  'consent.screen.subtitle': 'Choose how your records are handled — it\'s your choice, and you can change it anytime.',
  'consent.screen.continue_btn': 'Continue',
  'consent.screen.saving': 'Saving...',

  // general_health consent (S3 item 1)
  'consent.general_health.title': 'Health logging on this device',
  'consent.general_health.data_copy': 'The pregnancy-to-postpartum health details you enter yourself — such as your due date (EDD), weight, blood pressure, doctor-prescribed medications, symptoms you notice, kick counts, and delivery type. This is "health data," which the law protects specially, and it is kept on your device.',
  'consent.general_health.purpose_copy': 'To record your health information in the app\'s handbook and help summarize it so you can share it with your doctor. We use this only to "remind, log, and summarize" — never to diagnose, never to interpret your results in place of a doctor, and never for advertising.',
  'consent.general_health.grant_btn': 'Grant access',
  'consent.general_health.granted_label': 'Granted',
  'consent.general_health.required_note': 'Health logging permission not yet set',
  // Skip sheet (§3.1.6)
  'consent.general_health.skip_sheet.title': 'Health logging not granted yet',
  'consent.general_health.skip_sheet.body': 'That\'s okay — you can still use the app in read-only mode. You can browse the calendar, guidance, and content as usual, but you won\'t be able to save any health data (like your due date, medications, or weight) until you turn this on. You can enable it anytime in Account › Manage Permissions.',
  'consent.general_health.skip_sheet.go_back_btn': 'Go back & grant',
  'consent.general_health.skip_sheet.continue_anyway_btn': 'Continue anyway',

  // cloud_storage consent (S3 item 2)
  'consent.cloud_storage.title': 'Sync across your devices',
  'consent.cloud_storage.data_copy': 'The same health records you save on your device are sent to be stored securely on our server, which is located in Thailand. Your data is encrypted both in transit and at rest.',
  'consent.cloud_storage.purpose_copy': 'So your phone and tablet show the same records, and you have a backup in case you change or lose your device.',
  'consent.cloud_storage.off_note': 'Off is fine — works fully on device',

  // Shared consent UI
  'consent.text_version.label': 'Consent text',
  'consent.policy_link': 'Privacy Policy',
  'consent.change_later_note': 'Change these anytime in Account › Manage Permissions',

  // Error / retry panel (§3.1.5)
  'consent.error.save_failed': 'Couldn\'t save — will retry automatically',
  'consent.error.retry_btn': 'Retry',

  // Home screen limited-mode elements (§4.3)
  'consent.home.health_nudge_banner': 'Enable health logging ›',
  'consent.limited_mode.health_gate_inline': 'Health logging needs your ok first · Enable ›',
  'consent.limited_mode.health_gate_feeding_context': 'Enable health logging first to log feeding sessions',

  // Settings entry point
  'consent.settings.manage_btn': 'Manage Permissions',

  // ── pdf_egress JIT sheet ──────────────────────────────────────────────────
  'consent.pdf_egress.title': 'Create a PDF summary for your doctor',
  'consent.pdf_egress.body_copy': 'Your health records will be compiled into a PDF so you can easily share them with your doctor. This file is created only for you — we don\'t send it anywhere else.',
  'consent.pdf_egress.grant_btn': 'Grant access',
  'consent.pdf_egress.blocked_inline': 'PDF creation needs your permission · Go to Manage Permissions ›',

  // ── sensitive_lab_results JIT sheet ──────────────────────────────────────
  'consent.sensitive_lab.title': 'Include your test notes in the report',
  'consent.sensitive_lab.body_copy': 'In your checklist items you may have typed free-text notes, which can sometimes contain very sensitive results such as blood tests or screenings. If you agree, we\'ll include these notes in the PDF so your doctor sees the full picture.',
  'consent.sensitive_lab.hide_note': 'If off, notes are hidden; PDF still works',
  'consent.sensitive_lab.grant_btn': 'Grant & include notes',
  'consent.sensitive_lab.hide_btn': 'Hide notes',

  // ── infant_feeding JIT sheet ──────────────────────────────────────────────
  'consent.infant_feeding.title': 'Log your baby\'s feeding sessions',
  'consent.infant_feeding.body_copy': 'This is your baby\'s data, and you are giving consent as the parent or legal guardian. We store feeding times, amounts, which side, and any notes you type — to help you log feeds and include them in a PDF for your doctor.',
  'consent.infant_feeding.parental_note': 'Baby\'s data — you consent as parent',
  'consent.infant_feeding.grant_btn': 'Grant (as parent)',
  'consent.infant_feeding.parental_attest_label': 'I am the parent / legal guardian of this child',

  // ── child_health JIT sheet ────────────────────────────────────────────────
  'consent.child_health.title': 'Log your baby\'s health and symptoms',
  'consent.child_health.body_copy': 'This is your baby\'s health data, which the law protects specially. You are giving consent as the parent or legal guardian. We store your baby\'s symptoms and the health notes you record — to log them on your device, sync, and include them in a PDF for your doctor.',
  'consent.child_health.parental_note': 'Baby\'s data — you consent as parent',
  'consent.child_health.browse_note': 'Browsing symptom guidance without saving does not require this consent',
  'consent.child_health.grant_btn': 'Grant (as parent)',
  'consent.child_health.parental_attest_label': 'I am the parent / legal guardian of this child',

  // ── Shared JIT sheet UI ────────────────────────────────────────────────────
  'consent.jit.decline_btn': 'Not now',
  'consent.jit.change_later_note': 'Change this anytime in Account › Manage Permissions',
  'consent.jit.saving': 'Saving...',
  'consent.jit.save_failed': 'Couldn\'t save — retry',
  'consent.jit.retry_btn': 'Retry',

  // ── S8 Manage-Consents screen ─────────────────────────────────────────────
  'consent.manage.title': 'Manage Permissions',
  'consent.manage.subtitle': 'Turn any on or off. Turning off ≠ deleting data.',
  'consent.manage.section.core': 'Core',
  'consent.manage.section.sync': 'Sync & reports',
  'consent.manage.section.baby': 'Baby data',

  // S8 row short captions
  'consent.manage.row.general_health.caption': 'Due date · medications · weight · symptoms',
  'consent.manage.row.cloud_storage.caption': 'Same records across all your devices',
  'consent.manage.row.pdf_egress.caption': 'Summaries for your doctor',
  'consent.manage.row.sensitive_lab.caption': 'Free-text notes in all checklist items',

  // S8 withdrawal confirmation sheets
  'consent.manage.withdraw_confirm.general_health.title': 'Turn off health logging',
  'consent.manage.withdraw_confirm.general_health.body': 'The health records you\'ve already saved stay safe on this device — turning this off is not deleting your data. What changes is that you won\'t be able to save new health data until you turn this permission back on.',
  'consent.manage.withdraw_confirm.cloud_storage.title': 'Turn sync off',
  'consent.manage.withdraw_confirm.cloud_storage.body': 'All your records stay safe on this device. We\'ll stop syncing new data right away. Data previously stored in the cloud will be removed according to our data retention policy (not immediately).',
  'consent.manage.withdraw_confirm.infant_feeding.title': 'Turn off feeding log',
  'consent.manage.withdraw_confirm.infant_feeding.body': 'Your baby\'s saved feeding logs stay safe. Turning this off is not deleting data. You won\'t be able to log or sync new feeds until you turn it back on.',
  'consent.manage.withdraw_confirm.child_health.title': 'Turn off baby health log',
  'consent.manage.withdraw_confirm.child_health.body': 'Your baby\'s saved health and symptom logs stay safe. Turning this off is not deleting data. You won\'t be able to log or sync new baby health data until you turn it back on.',
  'consent.manage.withdraw_confirm.do_it_btn': 'Turn off this permission',
  'consent.manage.withdraw_confirm.cancel_btn': 'Cancel',

  // S8 loading / error states
  'consent.manage.load_error': 'Could not load your permissions',
  'consent.manage.load_retry_btn': 'Retry',
  'consent.manage.pending_sync_badge': 'Pending sync',

  // S8 footer
  'consent.manage.policy_link': 'Privacy Policy',
  'consent.manage.history_link': 'Consent history',

  // Toast feedback
  'consent.success.toast_grant': 'Permission granted',
  'consent.success.toast_off': 'Permission turned off',
  'consent.success.toast_on': 'Sync is on',

  // Home banner: policy version update
  'consent.home.version_update_banner': 'Privacy policy updated · See what changed ›',

  // Consent history
  'consent.history.title': 'Consent History',
  'consent.history.item.granted': 'Granted',
  'consent.history.item.withdrawn': 'Withdrawn',

  // ── Suggestion system (suggestion-flow-ui.md) ─────────────────────────────
  // Home banner — §5.3 suggestion banner
  'suggestion.banner.headline': 'New things to track for this stage',
  'suggestion.banner.view': 'View all',
  'suggestion.banner.dismiss': 'Dismiss',
  'suggestion.banner.dismissA11y': 'Dismiss this suggestion',
  'suggestion.banner.notMedicalAdvice': 'Not medical advice',

  // Suggestion flow screen — §1 / §3
  'suggestion.screen.title': 'Worth tracking this stage',
  'suggestion.screen.offers': 'These are offers, not instructions',
  'suggestion.screen.empty': 'Nothing new to track right now',
  'suggestion.screen.viewHidden': 'View hidden',
  'suggestion.screen.notMedicalAdvice': 'Not medical advice · Read the limits',

  // Card actions — §2.2
  'suggestion.action.start': 'Start',
  'suggestion.action.snooze': 'Snooze',
  'suggestion.action.dismiss': 'Not for me',
  'suggestion.action.reenable': 'Re-enable',
  'suggestion.action.snoozeTitle': 'Ask again when?',
  'suggestion.action.snooze3d': '3 days',
  'suggestion.action.snooze7d': '7 days',
  'suggestion.action.snooze14d': '14 days',
  'suggestion.action.snoozeConfirm': 'Confirm',
  'suggestion.action.snoozeCancel': 'Cancel',
  'suggestion.hidden.toast': 'Hidden',
  'suggestion.hidden.undo': 'Undo',

  // Dismissed list — §3.1
  'suggestion.dismissed.title': 'Hidden suggestions',
  'suggestion.dismissed.empty': 'Nothing hidden yet',

  // Evidence ribbons — §2.1
  'suggestion.evidence.HIGH': 'Evidence-backed (HIGH) · pending clinical sign-off',
  'suggestion.evidence.STRONG': 'Well-established (STRONG)',
  'suggestion.evidence.MODERATE': 'Common practice (MODERATE)',
  'suggestion.source.prefix': 'Source: ',

  // Capture-type glyphs — a11y
  'suggestion.captureType.kick_count': 'Kick count',
  'suggestion.captureType.medication': 'Medication',
  'suggestion.captureType.appointment': 'Appointment',
  'suggestion.captureType.supplies': 'Supplies',
  'suggestion.captureType.self_log': 'Self log',

  // Suggestion item titles and reason text — §2.1
  'suggestion.kick_count_start.title': 'Kick counting',
  'suggestion.kick_count_start.reason': 'Helps you and your doctor track your baby\'s movements day to day. Try counting after each meal.',
  'suggestion.triferdine_daily.title': 'Triferdine 150 (iron + folic acid) daily',
  'suggestion.triferdine_daily.reason': 'Helps reduce the risk of iron-deficiency anaemia during pregnancy.',
  'suggestion.anc_t1_checkup.title': 'First ANC visit',
  'suggestion.anc_t1_checkup.reason': 'The first trimester is a key time to start prenatal care.',
  'suggestion.anc_t2_checkup.title': 'Second-trimester check-up',
  'suggestion.anc_t2_checkup.reason': 'Tracks your baby\'s development and your health.',
  'suggestion.anc_t3_checkup.title': 'Third-trimester check-up',
  'suggestion.anc_t3_checkup.reason': 'Prepares you for birth and checks your baby\'s position.',
  'suggestion.anc_next_checkup.title': "It may be time to schedule your next prenatal check-up — would you like to add an appointment?",
  'suggestion.anc_next_checkup.reason': "Regular prenatal visits help your doctor monitor your baby's development and your health.",
  'appointment.reminder.toggleLabel': 'Reminder',
  'appointment.reminder.lead': '1 day before at 18:00',
  'appointment.reminder.lockScreenNote': 'Lock-screen notification will show a generic title (not the appointment name)',
  'suggestion.supplies_checklist.title': 'Prepare birth supplies',
  'suggestion.supplies_checklist.reason': 'Helps you get ready before your due date arrives.',
  'suggestion.postnatal_checkup.title': 'Postnatal check-up',
  'suggestion.postnatal_checkup.reason': 'Follow up after birth — typically scheduled at 6 weeks.',
  'suggestion.baby_feeding_log.title': 'Log feeding sessions',
  'suggestion.baby_feeding_log.reason': 'Track feeding times and amounts for your baby.',

  // ── PDF Doctor Report ─────────────────────────────────────────────────────────
  'pdf.cta': 'Create PDF for doctor',
  'pdf.ctaA11y': 'Create a health-summary PDF for your doctor',
  'pdf.generating': 'Creating PDF...',
  'pdf.shared': 'File shared',
  'pdf.sharedSubline': 'The PDF was opened in your chosen app.',
  'pdf.error': 'Could not create PDF — try again',
  'pdf.retry': 'Try again',
  'pdf.consentBlocked': 'PDF creation needs your permission · Go to Manage Permissions ›',
  /** Re-arm affordance (spec §4 — decline is frictionless and re-armable). */
  'pdf.tryConsent': 'Try again / Give consent',

  // ── Doctor PDF Screen (pdf-doctor-ui.md §1–§5) ────────────────────────────
  'pdf.screen.navTitle': 'Doctor report',
  'pdf.screen.builderTitle': 'Doctor report',
  'pdf.screen.previewNavTitle': 'Report preview',
  'pdf.screen.dateRangeLabel': 'Date range',
  'pdf.screen.monthFrom': 'Month from',
  'pdf.screen.monthTo': 'Month to',
  'pdf.screen.monthRangeError': 'Month from must not be after month to',
  'pdf.screen.manifestTitle': "What's included",
  'pdf.screen.manifestMedication': 'Medication & adherence',
  'pdf.screen.manifestKickCounts': 'Kick-counts',
  'pdf.screen.manifestSelfLogs': 'Self-logs (weight / BP / swelling)',
  'pdf.screen.manifestAppointments': 'Appointments & checklist',
  'pdf.screen.manifestLabNotes': 'Lab results / text notes (HIV etc.)',
  'pdf.screen.manifestLabDefault': 'Default: hidden',
  'pdf.screen.whereTitle': 'Where this file goes',
  'pdf.screen.whereLine1': 'Built on this device · shared only when you choose',
  'pdf.screen.whereLine2': 'No cloud copy unless you ask',
  'pdf.screen.previewBtn': 'Preview',
  'pdf.screen.shareBtn': 'Share',
  'pdf.screen.printBtn': 'Print',
  'pdf.screen.backToEdit': '‹ Edit',
  'pdf.screen.generating': 'Building report...',
  'pdf.screen.errorTitle': "Couldn't build the report — try again",
  'pdf.screen.retryBtn': 'Try again',
  'pdf.screen.sensitiveFileReminder': 'This file contains sensitive results',

  // ── Expenses ──────────────────────────────────────────────────────────────────
  'expenses.navTitle': 'Expenses',
  'expenses.shortcutBtn': 'Expenses ›',
  // Month total (§2.1)
  'expenses.totalLabel': 'Spent this month',
  'expenses.totalCount': '{n} expenses',
  // Category breakdown (§2.2)
  'expenses.category.baby-supplies': 'Baby supplies',
  'expenses.category.healthcare': 'Healthcare',
  'expenses.category.baby-gear': 'Baby gear',
  'expenses.category.mother': 'Mother',
  'expenses.category.other': 'Other',
  // List + empty (§4.2/§4.3)
  'expenses.emptyHeadline': 'No expenses this month',
  'expenses.emptyBody': "Jot what you spend and watch this month's total here.",
  'expenses.emptyPastMonth': 'No expenses in this month',
  'expenses.addFirst': '+ Add your first',
  // Row labels
  'expenses.noNote': '(no note)',
  // FAB + sheet header (§3.2)
  'expenses.add': '+ Add expense',
  'expenses.addTitle': 'Add expense',
  'expenses.editTitle': 'Edit expense',
  // Form fields (§3.2)
  'expenses.fieldAmount': 'Amount',
  'expenses.fieldCategory': 'Category',
  'expenses.fieldDate': 'Date',
  'expenses.fieldNote': 'Note (optional)',
  'expenses.notePrivacyLine': 'Kept on your device · never read or interpreted',
  // Echo line (§3.2)
  'expenses.echoPrefix': 'Will save as:',
  // Save / Delete / Cancel
  'expenses.save': 'Save',
  'expenses.delete': 'Delete',
  'expenses.deleteUndo': 'Undo',
  'expenses.deleteToast': 'Deleted',
  // Validation (§3.2)
  'expenses.errorAmountRequired': 'Enter an amount above zero.',
  // Sync status
  'expenses.loading': 'Loading',
  'expenses.syncError': 'Sync failed — try again',
  'expenses.conflictNote': 'Updated from another device',
  'expenses.rejectedNote': 'Some items were rejected',
  'expenses.refresh': 'Refresh',
  // Offline pill (spec §4.5 — calm warm-neutral; list stays interactive)
  'expenses.offlinePill': 'Offline · Saved on this device',
  // Error state (§4.4)
  'expenses.errorHeadline': "Couldn't open your expenses",
  'expenses.errorSubline': 'Your data is still here',

  // ── Quick Capture / Self-Log (capture-ui.md §2/§3/§4/§5) ─────────────────────
  'capture.navTitle': 'Log',
  'capture.close': 'Close',
  'capture.save': 'Save',
  'capture.typeLabel': 'Type:',
  'capture.type.weight': 'Weight',
  'capture.type.blood_pressure': 'Blood pressure',
  'capture.type.swelling': 'Swelling',
  'capture.type.lochia': 'Lochia',
  'capture.type.symptom': 'Symptom',
  'capture.field.when': 'When',
  'capture.field.note': 'Note (optional)',
  'capture.field.notePlaceholder': 'Type…',
  'capture.field.valuePlaceholder': 'Enter value',
  'capture.field.textPlaceholder': 'Describe…',
  'capture.notePrivacy': 'Kept on your device · never read or interpreted',
  'capture.echoPrefix': 'Will save as:',
  'capture.echoPlaceholder': '— fill in a value to preview —',
  'capture.saved': 'Saved',
  'capture.savedMsg': 'Entry saved',
  'capture.viewCalendar': 'View in calendar',
  'capture.done': 'Done',
  'capture.error': "Couldn't save — try again",
  'capture.retry': 'Try again',
  // Consent nudge (self-log-behavior §B.4 — general_health gate)
  'capture.consent.title': 'Health logging permission needed',
  'capture.consent.body': 'To record weight, blood pressure, and symptoms, please grant health logging permission — data stays on your device.',
  'capture.consent.grant': 'Grant access',
  'capture.consent.notNow': 'Not now',
  'capture.consent.changeLater': 'Change anytime in Account › Manage Permissions',
  // Unit labels (display only — not user-typed)
  'capture.unit.kg': 'kg',
  'capture.unit.mmHg': 'mmHg',

  // ── Quick Capture — Medication family (capture-ui §3.1 + medication-behavior §B) ─
  // Plan name / dose are VERBATIM. taken / missed EQUAL weight — never amber (INV-M2).
  'capture.type.medication': 'Medication',
  'capture.medication.takenLabel': 'Taken',
  'capture.medication.missedLabel': 'Not taken',
  'capture.medication.planFromLabel': 'From plan',
  'capture.medication.doseLabel': 'Dose',
  'capture.medication.statusLabel': 'Status',

  // ── Snooze chooser (Task 5 — medication-only 10/30/60 picker) ────────────────
  'reminder.snooze.title': 'Snooze reminder',
  /** template: {time} = computed re-alert time "HH:mm" — visible sub-label */
  'reminder.snooze.alertsAt': 'Alerts again at {time}',
  /** SR-only a11y label for the re-alert time — screens-spec §5.3/§5.6. NOT used for visible text. */
  'reminder.snooze.alertsAt.sr': 'Will alert again at {time}',
  'reminder.snooze.opt.10': '10 minutes',
  'reminder.snooze.opt.30': '30 minutes',
  'reminder.snooze.opt.60': '60 minutes',
  'reminder.snooze.cancel': 'Cancel',
  /** template: {time} = snoozedUntil "HH:mm" shown in occurrence row sub-label */
  'reminder.snoozedUntil': 'Snoozed until {time}',

  // ── Notification strings — medication reminder (design §5.4, SD-11) ──────────
  'notification.medication.title': 'Time for your medication',
  'notification.medication.body': 'Tap to see',
  'notification.action.markDone': 'Taken ✓',
  'notification.action.snooze': 'Snooze',

  // ── Medication Plans (medication-plan-ui.md §9) ──────────────────────────────
  'medication.navTitle': 'Medication Plans',
  'medication.tabLabel': 'Plans',
  'medication.emptyHeadline': 'No medication plans yet',
  'medication.emptyBody': "Add what you take and we'll remind you on schedule.",
  'medication.addFirst': '+ Add your first plan',
  'medication.addTitle': 'Add medication plan',
  'medication.editTitle': 'Edit medication plan',
  'medication.fieldName': 'Medication name (required)',
  'medication.fieldDose': 'Dose (optional)',
  'medication.fieldSchedule': 'Schedule',
  'medication.scheduleChip.daily': 'Daily',
  'medication.scheduleChip.every_n_days': 'Every N days',
  'medication.scheduleChip.one_off': 'One time',
  'medication.fieldTimesOfDay': 'Times',
  'medication.addTime': '+ Add a time',
  'medication.fieldInterval': 'Every how many days?',
  'medication.fieldStartDate': 'Starting from',
  'medication.fieldActive': 'Active',
  'medication.activeSubLabelOn': 'Generating reminders',
  'medication.activeSubLabelOff': 'Stopped — medication history kept',
  'medication.echoPrefix': 'Will appear in calendar as:',
  'medication.save': 'Save',
  'medication.add': '+ Add medication plan',
  'medication.deactivate': 'Deactivate plan',
  'medication.reactivate': 'Reactivate plan',
  'medication.delete': 'Delete plan',
  'medication.pausedDivider': 'Paused',
  'medication.inactiveTag': 'Inactive',
  'medication.encryptionNotice': 'Kept on device',
  'medication.privacyLine': 'Kept on device · never read or interpreted',
  'medication.deactivateToast': 'Plan paused · history kept',
  'medication.deleteToast': 'Plan removed',
  'medication.saveToast': 'Saved',
  'medication.savedLocalOnly': 'Saved on this device (not synced)',
  'medication.errorNameRequired': 'Add a name for this medication',
  'medication.errorTimeRequired': 'Pick at least one time',
  'medication.errorIntervalMin': 'Must be 2 days or more',
  'medication.saveError': "Couldn't save — try again",
  'medication.loadError': "Couldn't open your medication plans",
  'medication.consentNudgeTitle': 'Health logging needs your ok',
  'medication.consentNudgeAction': 'Enable logging ›',
  'medication.deleteConfirmTitle': 'Delete {name}?',
  'medication.deleteConfirmBody1': 'This plan will be removed. New reminders will stop.',
  'medication.deleteConfirmBody2': 'Your logged medication history stays.',
  'medication.deleteConfirmOk': 'Confirm delete',
  'medication.deleteConfirmCancel': 'Cancel',
  'medication.offlinePill': 'Offline · saved on this device',
  // a11y / M3: i18n for previously hardcoded Thai labels
  'medication.removeTime': 'Remove',
  'medication.confirmPicker': 'Done',
  'medication.timeField': 'Time',
  // Error state (B5)
  'medication.dataStillHere': 'Your data is still here',
  'medication.loadingSkeleton': 'Loading medication plans',
  // Consent banner (B4)
  'medication.consentBannerAction': 'Enable health logging ›',
  // Echo preview (F1)
  'medication.echoAndMore': 'and more',
  'medication.echoPlanned': 'Planned',
  // Deactivate/Delete sub-copy (F4)
  'medication.deactivateSubCopy1': 'Stops new reminders.',
  'medication.deactivateSubCopy2': 'Your medication history stays.',
  'medication.deleteSubCopy1': 'Removes from this list.',
  'medication.deleteSubCopy2': 'Logged history is kept.',
  // Save button disabled (F6)
  'medication.saveDisabledConsentLabel': 'Enable health logging to save',
  // Echo placeholder — shown when name is empty (§5.5 design #1)
  'medication.echoPlaceholder': 'Med name... · Time...',
  // PRN label — schedule-preview when plan has no schedule (§design #2)
  'medication.prnLabel': 'PRN',
  // Log a dose — quiet affordance on each active plan row (Task 11)
  'medication.logDose': 'Log a dose',

  // ── Account Rights (account-rights-ui.md §4) ──────────────────────────────────
  // S7 Settings rows (§4.1)
  'accountRights.downloadLabel': 'Download my data',
  'accountRights.downloadSubtitle': 'PDPA Art. 30/31',
  'accountRights.deleteLabel': 'Delete my account',
  'accountRights.deleteSubtitle': 'Permanently removes your account',
  // Export states (§4.2)
  'accountRights.export.inProgress': 'Preparing your data file...',
  'accountRights.export.errorTitle': "Download didn't complete",
  'accountRights.export.errorBody': 'Check your connection and try again.',
  'accountRights.export.retry': 'Retry',
  'accountRights.export.dismiss': 'Dismiss',
  'accountRights.export.notAvailableTitle': 'This data is no longer available.',
  'accountRights.export.backToSettings': 'Back to Settings',
  // Delete confirm sheet — title (§4.3)
  'accountRights.delete.sheetTitle': 'Delete your account',
  // Disclosure bullets — VERBATIM from 0e §5d item 3; NO retention number (D7/M-1)
  'accountRights.delete.disclosure1': "When you confirm, your account is deactivated right away — you'll be signed out on this device and won't be able to sign in again on any device.",
  'accountRights.delete.disclosure2': 'Your data is then permanently erased after a processing period, in line with our data-retention policy.',
  'accountRights.delete.disclosure3': "This can't be undone in the app, and there's no account recovery.",
  // Export-before-delete nudge (verbatim from 0e §5d item 3)
  'accountRights.delete.nudgeTitle': 'Want to keep a copy of your data first?',
  'accountRights.delete.nudgeBody': "After your account is deleted, you won't be able to download your data anymore. If you'd like to keep it, download it first.",
  'accountRights.delete.nudgeDownloadBtn': 'Download my data first',
  'accountRights.delete.nudgeSkipBtn': 'Skip and continue',
  // Type-to-confirm (§4.3, §3.7)
  'accountRights.delete.confirmLabel': 'Type "DELETE" to confirm',
  // confirmWord key REMOVED (was dead — never read by code). Single source of truth
  // for the confirm word is CONFIRM_WORDS in confirmWordMatch.ts. (#9)
  // confirmPlaceholder key REMOVED — placeholder is now derived from CONFIRM_WORDS[locale].
  // Buttons (§4.3)
  'accountRights.delete.confirmBtn': 'Delete my account',
  'accountRights.delete.cancelBtn': 'Cancel',
  'accountRights.delete.retryBtn': 'Retry',
  'accountRights.delete.biometricPrompt': 'Confirm to delete account',
  'accountRights.delete.biometricCancel': 'Cancel',
  // Biometric degrade notice (§4.3 — warm amber, NOT alarming red)
  'accountRights.delete.degradeNotice': 'Face/fingerprint authentication is temporarily unavailable — your typed confirmation will be used instead. Cancel and try again to use biometric authentication.',
  // Delete error (§4.3 — reassurance first; stays signed in)
  'accountRights.delete.errorTitle': 'Account deletion failed',
  'accountRights.delete.errorBody': 'Check your connection and try again. Your account is still intact.',

  // ── Bottom-tab navigation v2 (bottom-tab-navigation-design.md v2.1 §1.1, §8.2) ─
  // Tab order: Supplies · Expenses · Home (center) · Calendar · Medication
  // Visible tab labels
  'tab.supplies': 'Supplies',
  'tab.expenses': 'Expenses',
  'tab.home': 'Home',               // v2 CENTER tab
  'tab.calendar': 'Calendar',
  'tab.medication': 'Meds',
  // v3: 6th tab — Profile (§6.1, §13.1)
  'tab.profile': 'Profile',
  'tab.profile.short': 'Me',
  // Accessibility labels — full names for screen readers (spec §8.2)
  'tab.supplies.a11y': 'Baby Supplies List',            // v2: updated per OQ-NAV-5
  'tab.expenses.a11y': 'Expenses',
  'tab.home.a11y': 'Home and Pregnancy Overview',       // v2 center tab (§8.2)
  'tab.calendar.a11y': 'Calendar',                      // v2: simplified (grid-only)
  'tab.medication.a11y': 'Medication Plans',
  // v3: Profile tab a11y (§7.1)
  'tab.profile.a11y': 'Profile and Account',
  // Doctor Report entry row in Home tab scroll
  'home.doctorReport': 'Doctor report ›',
  // Feeding-log entry row in Home tab (Bug #4 — moved from Supplies tab).
  'home.feedingLog': 'Log feeding ›',
  // Kick-count card (pregnant wk≥32, spec §4.2)
  'kick.countCard': 'Time to count kicks ›',

  // ── Mother's Room re-skin (mother-room-build-spec.md §4.1) ──────────────────
  'home.greeting': 'Hello, Khun Mae',
  'home.tapForMilestone': 'Tap for weekly milestone',
  'home.captureToday': 'Add a log for today',
  'home.captureFeeling': 'Record your feelings today',
  'home.kickCountToday': 'today',

  // ── WeeklyMilestoneSheet (§4.2) ───────────────────────────────────────────────
  'milestone.close': '← Close',
  'milestone.closeSheet': 'Close weekly milestone sheet',
  'milestone.babySection': 'Your Baby',
  'milestone.maternitySection': 'Your Body',
  'milestone.tipSection': 'Tip',
  'milestone.journalCta': 'Write a journal entry today',
  'milestone.empty': 'No content available for this week',

  // ── Baby Size Comparison — Home Section ───────────────────────────────────────
  // EN disclaimer strings: LEGAL-APPROVED verbatim (G-size-1 advisory sign-off 2026-07-10).
  // Licensed-lawyer review still recommended before wide public launch.
  // DO NOT change the 3 disclaimer VALUES below without going back through legal.
  'home.babySizeSectionLabel': 'BABY SIZE',
  'home.babyYourBabySectionLabel': 'YOUR BABY',
  'home.babySizeSizeInfo': 'About ~{length} cm long · ~{weight}',
  'home.babySizeSizeInfoLengthOnly': 'About ~{length} cm long',
  'home.babyWarmNote': 'Every day of growth is a gift',
  // LEGAL-APPROVED verbatim (G-size-1 advisory sign-off 2026-07-10). DO NOT paraphrase.
  'home.babySizeDisclaimer': 'Approximate averages · general info, not medical advice · every baby is different',
  // LEGAL-APPROVED verbatim (G-size-1 advisory sign-off 2026-07-10). DO NOT paraphrase.
  'home.babySizeFullDisclaimer': 'The sizes and weights shown are approximate averages for each stage of pregnancy, provided for general information and enjoyment as you follow your baby\'s development. This is not a medical diagnosis or medical advice. Every baby grows differently, and that can be perfectly normal. If you have any questions or concerns about your pregnancy or your baby, please consult your doctor or healthcare provider.',
  // LEGAL-APPROVED verbatim (G-size-1 advisory sign-off 2026-07-10). DO NOT paraphrase.
  'home.babyPostpartumDisclaimer': 'Your baby\'s age is calculated from the birth date you entered, for general information only. This is not a developmental assessment or medical advice. Every child develops differently. If you have any concerns, please consult your doctor or healthcare provider.',
  'home.babySizeDisclaimerLink': 'Full disclaimer',
  'home.babySizeDisclaimerModalTitle': 'Important information',
  // [source/year to confirm before prod: research pass = BabyCenter Fetal Growth Chart; year 2024 pending confirmation on the cited page]
  'home.babySizeSourceRibbon': 'Approximate reference data: BabyCenter Fetal Growth Chart, 2024',

  // ── Auth: Forgot Password (S5) ───────────────────────────────────────────────
  // NON-ENUMERATION: confirmBody must NOT hint at whether the email has an account.
  'forgot.navTitle': 'Forgot password',
  'forgot.title': 'Forgot your password?',
  'forgot.subtitle': "Enter your email and we'll send you a reset link.",
  'forgot.emailLabel': 'Email',
  'forgot.emailPlaceholder': 'you@example.com',
  'forgot.emailHint': 'Please check the email address.',
  'forgot.submit': 'Send reset link',
  'forgot.confirmTitle': 'Check your inbox',
  /**
   * SEC-INV-1 NON-ENUMERATING: unconditional neutral statement — same whether or not the email has an account.
   */
  'forgot.confirmBody': "We've sent a password-reset link to your email. Please check your inbox (including spam).",
  'forgot.resend': 'Resend link',
  'forgot.backToLogin': 'Back to sign in',
  'forgot.rateLimited': 'Too many requests — please try again later.',
  'forgot.offline': "You're offline",
  'forgot.serverError': 'Something went wrong on our end — try again.',

  // ── Auth: Reset Password ──────────────────────────────────────────────────────
  'reset.navTitle': 'Reset password',
  'reset.title': 'Set a new password',
  'reset.newPasswordLabel': 'New password',
  'reset.confirmLabel': 'Confirm new password',
  'reset.passwordHint': 'At least 8 characters',
  'reset.revokeNotice': "Setting a new password signs you out on all devices; you'll need to sign in again.",
  'reset.submit': 'Save new password',
  'reset.successToast': 'Password updated — sign in with your new password.',
  'reset.tokenInvalid': 'This link is invalid or expired — request a new one.',
  'reset.requestNewLink': 'Request a new link',
  'reset.linkMissing': "This link isn't valid — request a new one.",
  'reset.passwordTooShort': 'Password too short — at least 8 characters.',
  'reset.passwordBreached': "This password isn't safe — please choose another.",
  'reset.mismatch': "The two passwords don't match.",
  'reset.rateLimited': 'Please try again later.',
  'reset.offline': "You're offline",
  'reset.serverError': 'Something went wrong on our end — try again.',

  // ── Pregnancy Summary Screen ──────────────────────────────────────────────────
  'pregnancySummary.rowLabel': 'Pregnancy Summary',
  'pregnancySummary.rowSubtitle': 'Review by trimester',

  'pregnancySummary.navTitle': 'Pregnancy Summary',

  // G-PS-d: each trimester shown as a separate fact — no cross-trimester trend copy.
  'pregnancySummary.t1': 'Trimester 1',
  'pregnancySummary.t2': 'Trimester 2',
  'pregnancySummary.t3': 'Trimester 3',

  // Kicks section
  // G-PS-b (INV-PS1): no verdict/badge/color.
  // G-PS-c: daysWithData must appear adjacent to avg — always-on.
  'pregnancySummary.kicks.sectionLabel': 'Kicks',
  'pregnancySummary.kicks.avgPerDay': 'Avg {avg} kicks/day',
  'pregnancySummary.kicks.daysWithData': 'from {days} days recorded',
  'pregnancySummary.kicks.noData': 'No data yet',

  // Medication section
  'pregnancySummary.meds.sectionLabel': 'Medications',
  'pregnancySummary.meds.distinctDays': '{days} days recorded',
  'pregnancySummary.meds.noData': 'No data yet',

  // Delivery section
  'pregnancySummary.delivery.sectionLabel': 'Delivery',
  'pregnancySummary.delivery.typeLabel': 'Delivery type',
  'pregnancySummary.delivery.admissionLabel': 'Admission date',
  'pregnancySummary.delivery.dischargeLabel': 'Discharge date',
  'pregnancySummary.delivery.noData': 'No delivery record yet',
  'pregnancySummary.delivery.notSpecified': 'Not specified',

  // Screen states
  'pregnancySummary.noEddPrompt': 'No due date set yet',
  'pregnancySummary.noEddAction': 'Set due date',
  'pregnancySummary.partialNote': 'Pregnancy in progress · some data may still be incomplete',

  // Disclaimer — VERBATIM (legal §3 G-summary-1; DO NOT paraphrase).
  // EN is a reviewed sign-off, NOT auto-translated (Z-2).
  // G-PS-a: both forms must be present.
  'pregnancySummary.disclaimer.short':
    'Your own recorded data, for personal review · not an assessment or medical advice',
  'pregnancySummary.disclaimer.seeMore': 'See more',
  'pregnancySummary.disclaimer.full':
    'The information on this screen is data you recorded yourself, gathered and grouped by stage of pregnancy so you can look back on it. It is not an assessment, diagnosis, or medical advice. If you have any questions or concerns about your health or your baby, please consult your doctor or healthcare provider.',

  // Hospital-stay fields in BirthEventScreen
  // OQ-PS4: warn (not block) if admission is far from birthDate.
  'birth.fieldHospitalStaySection': 'Hospital stay (optional)',
  'birth.fieldHospitalAdmission': 'Admission date (optional)',
  'birth.fieldHospitalDischarge': 'Discharge date (optional)',
  'birth.hospitalAdmissionPlaceholder': 'Choose a date (optional)',
  'birth.hospitalDischargePlaceholder': 'Choose a date (optional)',
  'birth.hospitalAdmissionModalTitle': 'Select admission date',
  'birth.hospitalDischargeModalTitle': 'Select discharge date',
  'birth.hospitalAdmissionModalHint': 'Enter date as YYYY-MM-DD, e.g. 2026-06-29',
  'birth.hospitalDischargeModalHint': 'Enter date as YYYY-MM-DD, e.g. 2026-06-29',
  'birth.warnAdmissionFarFromBirthTitle': 'Check the date',
  'birth.warnAdmissionFarFromBirthMsg':
    'The admission date is quite far from the birth date — continue with this date?',
  'birth.warnFarContinue': 'Continue',
  'birth.warnFarCancel': 'Cancel',
  'birth.errorDischargeBeforeAdmission': 'Discharge date must not be before admission date',
  'birth.errorHospitalDateFuture': "This date hasn't happened yet",

  // ─── Pregnancy-loss recording (write path) — Z-19 COPY GATE ─────────────────
  // Placeholder/tone-appropriate strings only — NOT final. See th catalog comment.
  'loss.navTitle': 'Record pregnancy ending',
  'loss.entry.link': 'This pregnancy has ended',
  'loss.confirm.title': 'Record the ending of this pregnancy',
  'loss.confirm.body': "Once recorded, the app will stop showing this pregnancy's progress content. Everything you've recorded before stays intact.",
  'loss.confirm.dateLabel': 'Date (optional)',
  'loss.confirm.dateSkipHint': 'You can leave this blank — it is not required.',
  'loss.confirm.datePlaceholder': 'Choose a date (optional)',
  'loss.confirm.primaryBack': 'Go back',
  'loss.confirm.quietConfirm': 'Confirm: record this pregnancy as ended',
  'loss.confirm.disclaimer': 'This is recorded by you — not a medical document.',
  'loss.confirm.submitting': 'Saving',
  'loss.confirm.dateRangeHint': "This date is outside the range that can be recorded · you can leave it blank",
  'loss.confirm.dateMalformedHint': 'Please check the date format again (YYYY-MM-DD)',
  'loss.result.quietAck': 'Recorded',
  'loss.error.consentRequired': 'Recording this requires the "store health data on device" permission to be on.',
  'loss.error.conflict': 'Another device made a change — your view has been updated.',
  'loss.error.goToConsent': 'Go to consent settings',
  'loss.error.offlineQueued': "Offline · not saved yet — it will retry automatically once you're back online",
  'loss.reopen.entry': 'Edit this record',
  'loss.reopen.confirm.title': 'Return to pregnancy tracking',
  'loss.reopen.confirm.body': 'This record will be corrected, and the app will show pregnancy-progress content again.',
  'loss.reopen.confirm.quietConfirm': 'Confirm: correct and return to tracking',
};

// ─── Exports ──────────────────────────────────────────────────────────────────

/** All valid message keys — inferred from the Thai catalog shape. */
export type MessageKey = keyof MsgShape;

/** The complete message catalog indexed by locale and then by MessageKey. */
export const catalog: Record<Locale, MsgShape> = { th, en };
