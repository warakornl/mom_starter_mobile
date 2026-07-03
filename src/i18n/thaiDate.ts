/**
 * Display-only date formatting. BE/CE conversion and Thai month names NEVER
 * affect calendar bucketing or the occurrence id (those use the raw civil date).
 */
const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Abbreviated Thai month names (3-char with dot, e.g. "มิ.ย.") */
const TH_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Abbreviated English month names (3-char, e.g. "Jun") */
const EN_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Thai day-of-week names (Sun=0 … Sat=6) */
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

/** English day-of-week names (Sun=0 … Sat=6) */
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Locale = 'th' | 'en';

/** Buddhist Era = Common Era + 543. */
export function toBuddhistYear(ceYear: number): number {
  return ceYear + 543;
}

/** Format a civil "YYYY-MM-DD" for display. th → BE + Thai months; en → CE. */
export function formatFullDate(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (locale === 'th') {
    return `วันที่ ${d} ${TH_MONTHS[m - 1]} พ.ศ. ${toBuddhistYear(y)}`;
  }
  return `${EN_MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Format a civil "YYYY-MM-DD" for the Quick Capture "when" row (blocker #7).
 *
 * Spec §2/§7 format:
 *   th → "วัน<dayofweek>ที่ D MMM BE"  e.g. "วันอาทิตย์ที่ 28 มิ.ย. 2569"
 *   en → "<Day> D MMM YYYY"            e.g. "Sunday 28 Jun 2026"
 *
 * Uses abbreviated month names and local civil date (no timezone conversion).
 * NEVER affects calendar bucketing — display only.
 */
export function formatCaptureDate(isoDate: string, locale: Locale): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Parse at midnight local time (civil date — no timezone shift)
  const date = new Date(y, m - 1, d);
  const dow = date.getDay(); // 0=Sun … 6=Sat

  if (locale === 'th') {
    return `วัน${TH_DAYS[dow]}ที่ ${d} ${TH_MONTHS_SHORT[m - 1]} ${toBuddhistYear(y)}`;
  }
  return `${EN_DAYS[dow]} ${d} ${EN_MONTHS_SHORT[m - 1]} ${y}`;
}
