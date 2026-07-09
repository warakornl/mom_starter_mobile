/**
 * babySizeData.ts — Week-to-fruit comparison data table.
 *
 * Static consumer pregnancy comparison data (no API call, offline-safe).
 * Covers gestational weeks 5–40 with fruit name (th/en), approximate size,
 * and icon key for rendering.
 *
 * Design ground-truth: docs/design/baby-size-home-section.md §4, §5, §8
 * Legal ground-truth:  docs/legal/baby-size-content-legal.md §5 (S1–S4)
 *
 * S1: "approximately/average" framing is enforced in the display layer
 *     (~ prefix always added by the component/i18n template).
 * S2: No health-status words (ปกติ/ผิดปกติ/สุขภาพดี/สมส่วน/ตามเกณฑ์) in
 *     any nameTh, nameEn, or other content string. Enforced by denylist test.
 * S4: This module accepts NO mother-entered health fields — data source is
 *     fixed static table; lookup key is server-derived gestationalWeek only.
 *
 * S6/S7 Invariant (legal §5 CR-1 — Milk Code / no-ad-targeting):
 * gestationalWeek used to look up entries MUST NEVER be wired into:
 *   • any ad selection, product recommendation, or feeding-introduction path
 *   • any infant-feeding or food-introduction content tied to age
 * This is a permanent legal invariant. Refs: legal §5 S6/S7, CR-1, register Z-13.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type BabySizeIconKey =
  | 'small-round'       // wks 5–9, 11–13 (seed/blueberry/grape/cherry/lime/lemon)
  | 'strawberry'        // wk 10
  | 'apple'             // wks 14–15
  | 'avocado'           // wk 16
  | 'pear'              // wk 17
  | 'mango'             // wks 18–19
  | 'banana'            // wk 20
  | 'carrot'            // wk 21
  | 'papaya'            // wks 22, 26, 36
  | 'corn'              // wks 23–24
  | 'pineapple'         // wks 25, 32–33
  | 'eggplant'          // wks 27–28
  | 'squash'            // wks 29–30 (น้ำเต้า / bottle gourd)
  | 'large-ribbed-round' // wks 31, 34–35, 40 (coconut/แตงไทย/pumpkin)
  | 'watermelon';       // wks 37–39

export interface BabySizeEntry {
  week: number;
  /** Thai fruit/object name — e.g. "กล้วยหอม". No health-status words (S2). */
  nameTh: string;
  /** English fruit/object name — e.g. "Banana". No health-status words (S2). */
  nameEn: string;
  /** Length as numeric string WITHOUT tilde, e.g. "25" (cm). Component adds ~. */
  lengthCm: string;
  /** Weight in grams. null for wks 5–7 (legal S2: <1g reads clinical). */
  weightG: number | null;
  /** true when weightG >= 1000 (display as กก. / kg). */
  weightIsKg: boolean;
  iconKey: BabySizeIconKey;
}

// ─── Static data table (weeks 5–40) ──────────────────────────────────────────
// Values: widely-published consumer pregnancy approximations — not clinical
// biometry. Disclaimer in home.babySizeDisclaimer covers this.
// Crown-rump length (CRL) for wks 5–19; crown-heel length (CHL) for wks 20+.

export const BABY_SIZE_DATA: BabySizeEntry[] = [
  // ── T1 ──────────────────────────────────────────────────────────────────────
  { week: 5,  nameTh: 'เมล็ดงา',       nameEn: 'Sesame seed',   lengthCm: '0.1',  weightG: null, weightIsKg: false, iconKey: 'small-round' },
  { week: 6,  nameTh: 'ถั่วเลนทิล',    nameEn: 'Lentil',        lengthCm: '0.2',  weightG: null, weightIsKg: false, iconKey: 'small-round' },
  { week: 7,  nameTh: 'บลูเบอร์รี่',   nameEn: 'Blueberry',     lengthCm: '1',    weightG: null, weightIsKg: false, iconKey: 'small-round' },
  { week: 8,  nameTh: 'องุ่น',          nameEn: 'Grape',         lengthCm: '1.5',  weightG: 1,    weightIsKg: false, iconKey: 'small-round' },
  { week: 9,  nameTh: 'เชอร์รี่',      nameEn: 'Cherry',        lengthCm: '2.5',  weightG: 2,    weightIsKg: false, iconKey: 'small-round' },
  { week: 10, nameTh: 'สตรอว์เบอร์รี่', nameEn: 'Strawberry',   lengthCm: '3',    weightG: 4,    weightIsKg: false, iconKey: 'strawberry' },
  { week: 11, nameTh: 'มะนาว',          nameEn: 'Lime',          lengthCm: '4',    weightG: 7,    weightIsKg: false, iconKey: 'small-round' },
  { week: 12, nameTh: 'เลมอน',          nameEn: 'Lemon',         lengthCm: '5.5',  weightG: 14,   weightIsKg: false, iconKey: 'small-round' },
  { week: 13, nameTh: 'เลมอน',          nameEn: 'Lemon',         lengthCm: '7',    weightG: 23,   weightIsKg: false, iconKey: 'small-round' },
  // ── T2 ──────────────────────────────────────────────────────────────────────
  { week: 14, nameTh: 'แอปเปิ้ล',       nameEn: 'Apple',         lengthCm: '8.5',  weightG: 43,   weightIsKg: false, iconKey: 'apple' },
  { week: 15, nameTh: 'แอปเปิ้ล',       nameEn: 'Apple',         lengthCm: '10',   weightG: 70,   weightIsKg: false, iconKey: 'apple' },
  { week: 16, nameTh: 'อโวคาโด',        nameEn: 'Avocado',       lengthCm: '11.5', weightG: 100,  weightIsKg: false, iconKey: 'avocado' },
  // wk17 13cm per research pass (BabyCenter); [clinician to confirm]
  { week: 17, nameTh: 'ลูกแพร์',        nameEn: 'Pear',          lengthCm: '13',   weightG: 140,  weightIsKg: false, iconKey: 'pear' },
  { week: 18, nameTh: 'มะม่วง',         nameEn: 'Mango',         lengthCm: '14',   weightG: 190,  weightIsKg: false, iconKey: 'mango' },
  { week: 19, nameTh: 'มะม่วง',         nameEn: 'Mango',         lengthCm: '15',   weightG: 240,  weightIsKg: false, iconKey: 'mango' },
  { week: 20, nameTh: 'กล้วยหอม',       nameEn: 'Banana',        lengthCm: '25',   weightG: 300,  weightIsKg: false, iconKey: 'banana' },
  { week: 21, nameTh: 'แครอท',          nameEn: 'Carrot',        lengthCm: '26',   weightG: 360,  weightIsKg: false, iconKey: 'carrot' },
  { week: 22, nameTh: 'มะละกอ',         nameEn: 'Papaya',        lengthCm: '27',   weightG: 430,  weightIsKg: false, iconKey: 'papaya' },
  { week: 23, nameTh: 'ข้าวโพด',        nameEn: 'Corn',          lengthCm: '29',   weightG: 500,  weightIsKg: false, iconKey: 'corn' },
  { week: 24, nameTh: 'ข้าวโพด',        nameEn: 'Corn',          lengthCm: '30',   weightG: 600,  weightIsKg: false, iconKey: 'corn' },
  { week: 25, nameTh: 'สับปะรด',        nameEn: 'Pineapple',     lengthCm: '35',   weightG: 660,  weightIsKg: false, iconKey: 'pineapple' },
  { week: 26, nameTh: 'มะละกอ',         nameEn: 'Papaya',        lengthCm: '36',   weightG: 760,  weightIsKg: false, iconKey: 'papaya' },
  { week: 27, nameTh: 'มะเขือม่วง',     nameEn: 'Eggplant',      lengthCm: '37',   weightG: 875,  weightIsKg: false, iconKey: 'eggplant' },
  // ── T3 ──────────────────────────────────────────────────────────────────────
  { week: 28, nameTh: 'มะเขือม่วง',     nameEn: 'Eggplant',      lengthCm: '38',   weightG: 1000, weightIsKg: true,  iconKey: 'eggplant' },
  { week: 29, nameTh: 'น้ำเต้า',        nameEn: 'Bottle gourd',  lengthCm: '39',   weightG: 1200, weightIsKg: true,  iconKey: 'squash' },
  { week: 30, nameTh: 'น้ำเต้า',        nameEn: 'Bottle gourd',  lengthCm: '40',   weightG: 1300, weightIsKg: true,  iconKey: 'squash' },
  { week: 31, nameTh: 'มะพร้าว',        nameEn: 'Coconut',       lengthCm: '41',   weightG: 1500, weightIsKg: true,  iconKey: 'large-ribbed-round' },
  { week: 32, nameTh: 'สับปะรด',        nameEn: 'Pineapple',     lengthCm: '42',   weightG: 1700, weightIsKg: true,  iconKey: 'pineapple' },
  { week: 33, nameTh: 'สับปะรด',        nameEn: 'Pineapple',     lengthCm: '44',   weightG: 1900, weightIsKg: true,  iconKey: 'pineapple' },
  { week: 34, nameTh: 'แตงไทย',         nameEn: 'Thai muskmelon', lengthCm: '45',  weightG: 2100, weightIsKg: true,  iconKey: 'large-ribbed-round' },
  { week: 35, nameTh: 'แตงไทย',         nameEn: 'Thai muskmelon', lengthCm: '46',  weightG: 2400, weightIsKg: true,  iconKey: 'large-ribbed-round' },
  { week: 36, nameTh: 'มะละกอ',         nameEn: 'Papaya',        lengthCm: '47',   weightG: 2600, weightIsKg: true,  iconKey: 'papaya' },
  { week: 37, nameTh: 'แตงโม',          nameEn: 'Watermelon',    lengthCm: '49',   weightG: 2900, weightIsKg: true,  iconKey: 'watermelon' },
  { week: 38, nameTh: 'แตงโม',          nameEn: 'Watermelon',    lengthCm: '50',   weightG: 3100, weightIsKg: true,  iconKey: 'watermelon' },
  { week: 39, nameTh: 'แตงโม',          nameEn: 'Watermelon',    lengthCm: '51',   weightG: 3300, weightIsKg: true,  iconKey: 'watermelon' },
  { week: 40, nameTh: 'ฟักทอง',         nameEn: 'Pumpkin',       lengthCm: '51',   weightG: 3400, weightIsKg: true,  iconKey: 'large-ribbed-round' },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Look up the baby-size comparison entry for a given gestational week.
 *
 * Fallback rules (design §4):
 *   - week === null/undefined or week < 5 → null (section hidden)
 *   - week 5–40 → exact match
 *   - week > 40 → week-40 entry (overdue)
 *
 * S4 invariant: this function accepts ONLY a gestational week number derived
 * from server civil-date computation (EDD/gestationalWeek). No mother-entered
 * health field (weight, BP, symptoms, self-log) can be passed here.
 */
export function getBabySizeEntry(
  gestationalWeek: number | null | undefined,
): BabySizeEntry | null {
  if (gestationalWeek == null || gestationalWeek < 5) return null;
  const wk = Math.min(gestationalWeek, 40);
  return BABY_SIZE_DATA.find((e) => e.week === wk) ?? null;
}

// ─── Weight formatting ────────────────────────────────────────────────────────

/**
 * Format weight for display (includes unit suffix, excludes ~ prefix).
 * The ~ prefix is added by the i18n template ("ยาวประมาณ ~{length} ซม. · ~{weight}").
 *
 * @param weightG   Weight in grams (always an integer from the data table)
 * @param weightIsKg true when weight should display as กก./kg (≥1000g entries)
 * @param locale    Display locale — determines unit suffix (ก./กก. vs g/kg)
 * @returns Formatted string e.g. "300 ก." / "300 g" / "1.2 กก." / "1.2 kg"
 */
export function formatWeightDisplay(
  weightG: number,
  weightIsKg: boolean,
  locale: 'th' | 'en',
): string {
  if (weightIsKg) {
    const kg = weightG / 1000;
    const kgStr = kg % 1 === 0 ? `${kg}` : `${kg.toFixed(1)}`;
    return locale === 'th' ? `${kgStr} กก.` : `${kgStr} kg`;
  }
  return locale === 'th' ? `${weightG} ก.` : `${weightG} g`;
}
