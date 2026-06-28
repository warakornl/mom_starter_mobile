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
