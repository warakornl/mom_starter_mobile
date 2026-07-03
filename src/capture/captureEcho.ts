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
 * Locale fix (blocker #6): metric labels and units are caller-supplied
 * (from i18n via CaptureScreen) — NOT hard-coded Thai. CaptureScreen passes
 * t('capture.type.*') for labels and t('capture.unit.*') for units.
 *
 * The ▪ mark = design-system §6 LOGGED status mark (filled square / "noted").
 */

// ─── EchoLine type ────────────────────────────────────────────────────────────

export type EchoLine =
  | { type: 'text'; value: string }
  | { type: 'placeholder' };

/** Design-system §6 LOGGED mark — ▪ (filled square, "noted" tick) */
const LOG_MARK = '▪';

/** Separator between value and time in the echo line (capture-ui §2 wireframe) */
const SEP = '·';

// ─── Echo builders ────────────────────────────────────────────────────────────

/**
 * Build the echo line for a weight self-log.
 *
 * Spec example (capture-ui §3.2):
 *   th → ▪ น้ำหนัก 64.2 กก. · 13:00
 *   en → ▪ Weight 64.2 kg · 13:00
 *
 * @param value   user-typed weight string (verbatim, e.g. "64.2")
 * @param time    HH:mm (e.g. "13:00")
 * @param label   i18n metric label — t('capture.type.weight')
 * @param unit    i18n unit label   — t('capture.unit.kg')
 */
export function buildWeightEchoLine(
  value: string,
  time: string,
  label: string,
  unit: string,
): EchoLine {
  const v = value.trim();
  if (!v) return { type: 'placeholder' };
  return {
    type: 'text',
    value: `${LOG_MARK} ${label} ${v} ${unit} ${SEP} ${time}`,
  };
}

/**
 * Build the echo line for a blood pressure self-log.
 *
 * Spec example (capture-ui §3.3):
 *   th → ▪ ความดัน 120/78 mmHg · 13:00
 *   en → ▪ Blood pressure 120/78 mmHg · 13:00
 *
 * INV-S1 (AC-20): BP 150/95 and 110/70 render with IDENTICAL visual weight
 * and structure — no colouring, no arrows, no "normal/high/low."
 *
 * @param systolic   user-typed systolic string (verbatim)
 * @param diastolic  user-typed diastolic string (verbatim)
 * @param time       HH:mm
 * @param label      i18n metric label — t('capture.type.blood_pressure')
 * @param unit       i18n unit label   — t('capture.unit.mmHg')
 */
export function buildBpEchoLine(
  systolic: string,
  diastolic: string,
  time: string,
  label: string,
  unit: string,
): EchoLine {
  const s = systolic.trim();
  const d = diastolic.trim();
  if (!s || !d) return { type: 'placeholder' };
  return {
    type: 'text',
    value: `${LOG_MARK} ${label} ${s}/${d} ${unit} ${SEP} ${time}`,
  };
}

/**
 * Build the echo line for text-value self-log types (swelling, lochia, symptom).
 *
 * Spec examples (capture-ui §1 + self-log-behavior.md §1):
 *   th swelling → ▪ บวม เล็กน้อย · 13:00
 *   en swelling → ▪ Swelling mild · 13:00
 *   th lochia   → ▪ น้ำคาวปลา … · 13:00
 *   th symptom  → ▪ อาการ คลื่นไส้ · 13:00
 *
 * INV-S4: valueText is NEVER parsed, scored, or graded — shown verbatim.
 *
 * @param label      i18n metric label — t('capture.type.<type>')
 * @param valueText  user's descriptive text (verbatim)
 * @param time       HH:mm
 */
export function buildTextEchoLine(
  label: string,
  valueText: string,
  time: string,
): EchoLine {
  const v = valueText.trim();
  if (!v) return { type: 'placeholder' };
  return {
    type: 'text',
    value: `${LOG_MARK} ${label} ${v} ${SEP} ${time}`,
  };
}
