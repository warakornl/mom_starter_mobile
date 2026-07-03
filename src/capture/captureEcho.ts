/**
 * captureEcho — builds the live-preview "echo line" for Quick Capture.
 *
 * The echo line is the signature element of Quick Capture (capture-ui.md §0):
 *   "As she types '64.2', the echo line reads ▪ น้ำหนัก 64.2 กก. · 09:10 —
 *    the same row, same logged-square mark, same verbatim value."
 *
 * INVARIANTS:
 *  - Values shown VERBATIM — no rounding, no interpretation (AC-19/20).
 *  - NEVER coloured or graded: BP 150/95 and 110/70 render identically (INV-S1).
 *  - No health verdict words in any output (INV-S3 / product §6).
 *  - Empty/blank value → { type: 'placeholder' } (no preview until value exists).
 *
 * The ▪ mark = design-system §6 LOGGED status mark (filled square / "noted").
 */

// ─── EchoLine type ────────────────────────────────────────────────────────────

export type EchoLine =
  | { type: 'text'; value: string }
  | { type: 'placeholder' };

// ─── Thai metric type labels (localized display — capture-ui §3.2/§3.3) ───────

const METRIC_LABEL: Readonly<Record<string, string>> = {
  weight:         'น้ำหนัก',
  blood_pressure: 'ความดัน',
  swelling:       'บวม',
  lochia:         'น้ำคาวปลา',
  symptom:        'อาการ',
};

/** Design-system §6 LOGGED mark — ▪ (filled square, "noted" tick) */
const LOG_MARK = '▪';

/** Separator between value and time in the echo line (capture-ui §2 wireframe) */
const SEP = '·';

// ─── Echo builders ────────────────────────────────────────────────────────────

/**
 * Build the echo line for a weight self-log.
 *
 * Spec example (capture-ui §3.2): ▪ น้ำหนัก 64.2 กก. · 13:00
 *
 * @param value   user-typed weight string (verbatim, e.g. "64.2")
 * @param time    HH:mm (e.g. "13:00")
 */
export function buildWeightEchoLine(value: string, time: string): EchoLine {
  const v = value.trim();
  if (!v) return { type: 'placeholder' };
  return {
    type: 'text',
    value: `${LOG_MARK} ${METRIC_LABEL.weight} ${v} กก. ${SEP} ${time}`,
  };
}

/**
 * Build the echo line for a blood pressure self-log.
 *
 * Spec example (capture-ui §3.3): ▪ ความดัน 120/78 mmHg · 13:00
 *
 * INV-S1 (AC-20): BP 150/95 and 110/70 render with IDENTICAL visual weight
 * and structure — no colouring, no arrows, no "normal/high/low."
 *
 * @param systolic   user-typed systolic string (verbatim)
 * @param diastolic  user-typed diastolic string (verbatim)
 * @param time       HH:mm
 */
export function buildBpEchoLine(systolic: string, diastolic: string, time: string): EchoLine {
  const s = systolic.trim();
  const d = diastolic.trim();
  if (!s || !d) return { type: 'placeholder' };
  return {
    type: 'text',
    value: `${LOG_MARK} ${METRIC_LABEL.blood_pressure} ${s}/${d} mmHg ${SEP} ${time}`,
  };
}

/**
 * Build the echo line for text-value self-log types (swelling, lochia, symptom).
 *
 * Spec examples (capture-ui §1 + self-log-behavior.md §1):
 *   swelling → ▪ บวม เล็กน้อย · 13:00
 *   lochia   → ▪ น้ำคาวปลา … · 13:00
 *   symptom  → ▪ อาการ คลื่นไส้ · 13:00
 *
 * INV-S4: valueText is NEVER parsed, scored, or graded — shown verbatim.
 *
 * @param metricType  'swelling' | 'lochia' | 'symptom'
 * @param valueText   user's descriptive text (verbatim)
 * @param time        HH:mm
 */
export function buildTextEchoLine(
  metricType: 'swelling' | 'lochia' | 'symptom',
  valueText: string,
  time: string,
): EchoLine {
  const v = valueText.trim();
  if (!v) return { type: 'placeholder' };
  const label = METRIC_LABEL[metricType];
  return {
    type: 'text',
    value: `${LOG_MARK} ${label} ${v} ${SEP} ${time}`,
  };
}
