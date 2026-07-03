/**
 * reportCharts — pure, deterministic SVG chart string generators.
 *
 * These functions are pure: same input → same SVG string output.
 * No side effects, no native APIs, no canvas — unit-testable in Node.
 *
 * Used by:
 *   - doctorReportAssembler.ts  (SVG embedded in report HTML → expo-print PDF)
 *   - DoctorPdfScreen.tsx       (same SVG rendered via react-native-svg SvgXml)
 *
 * Single-source-of-truth: the preview and the PDF use the SAME SVG string from
 * these functions, preventing drift between what the mother sees and what the
 * doctor receives.
 *
 * K-5b invariant (NEVER violate):
 *   NO valence coloring. Bars use neutral ink only.
 *   Do NOT add red / green / amber to signal "good" or "bad" kick counts.
 *   The spec (pdf-doctor-ui.md §3) forbids interpretation — values are verbatim.
 *
 * Security:
 *   - Pure string generators; they NEVER receive auth tokens or credentials.
 *   - Call only on the post-consent path (consent gate is enforced by the caller).
 *   - Output strings contain no executable code; all user data is SVG-escaped.
 */

// ─── SVG escape helper ────────────────────────────────────────────────────────

/**
 * escSvg — escape characters that are special in SVG attribute values and
 * text content: & < > "
 * Must be applied to any dynamic string placed inside the SVG.
 */
function escSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** One data point in a bar chart. */
export interface BarChartSeries {
  /** X-axis label for this bar (e.g. a civil date "YYYY-MM-DD"). */
  label: string;
  /** The numeric value this bar represents (non-negative integer). */
  value: number;
}

/** Options for barChartSvg. */
export interface BarChartOptions {
  /** Data points — one bar per entry. */
  series: BarChartSeries[];
  /** SVG viewBox / rendered width in px (default 500). */
  width?: number;
  /** SVG viewBox / rendered height in px (default 220). */
  height?: number;
  /** Text rendered in the center when series is empty (default 'No data'). */
  noDataLabel?: string;
  /** Optional single caption line below the chart (e.g. "3 sessions · avg 8"). */
  caption?: string;
  /** Accessible chart title for screen-readers and <title> element. */
  title?: string;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAD_LEFT = 40;
const PAD_RIGHT = 20;
const PAD_TOP = 28;      // space for value labels above tallest bar
const PAD_BOTTOM = 44;   // space for x-axis date labels
const CAPTION_RESERVE = 22; // reserved height when caption is present

/** Neutral ink bar color — design-system NEUTRAL_600. K-5b: no red/green/amber. */
const BAR_FILL = '#5F4A52';
/** Text color for value labels above bars. */
const VALUE_TEXT_COLOR = '#3A2A30';
/** Text color for x-axis date labels and caption. */
const MUTED_TEXT_COLOR = '#94818A';
/** Baseline stroke color. */
const BASELINE_COLOR = '#EBE1D9';

// ─── barChartSvg ─────────────────────────────────────────────────────────────

/**
 * barChartSvg — generic bar chart SVG string generator.
 *
 * Produces an `<svg>…</svg>` string suitable for:
 *   - Direct embedding in an HTML string (`innerHTML` / expo-print)
 *   - Rendering via react-native-svg's <SvgXml xml={...} />
 *
 * Deterministic: identical inputs → identical output string.
 * K-5b: BAR_FILL is a neutral ink color; no valence applied regardless of values.
 */
export function barChartSvg(options: BarChartOptions): string {
  const {
    series,
    width = 500,
    height = 220,
    noDataLabel = 'No data',
    caption,
    title = 'Bar chart',
  } = options;

  const escapedTitle = escSvg(title);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (series.length === 0) {
    const cx = Math.round(width / 2);
    const cy = Math.round(height / 2);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapedTitle}">` +
      `\n  <title>${escapedTitle}</title>` +
      `\n  <text x="${cx}" y="${cy}" text-anchor="middle" fill="${MUTED_TEXT_COLOR}" font-family="sans-serif" font-size="13">${escSvg(noDataLabel)}</text>` +
      `\n</svg>`
    );
  }

  // ── Chart geometry ───────────────────────────────────────────────────────
  const captionH = caption ? CAPTION_RESERVE : 0;
  const chartW = width - PAD_LEFT - PAD_RIGHT;
  const chartH = height - PAD_TOP - PAD_BOTTOM - captionH;

  const n = series.length;
  // Allocate bar width: leave a minimum gap between bars.
  const totalGap = Math.max(n - 1, 0) * 4;
  const barWidth = Math.max(4, Math.floor((chartW - totalGap) / n));
  const gap = n > 1 ? Math.floor((chartW - barWidth * n) / (n - 1)) : 0;

  const maxVal = Math.max(...series.map((s) => s.value));
  const baselineY = PAD_TOP + chartH;

  // ── Baseline ─────────────────────────────────────────────────────────────
  const baseline =
    `  <line x1="${PAD_LEFT}" y1="${baselineY}" x2="${PAD_LEFT + chartW}" y2="${baselineY}" stroke="${BASELINE_COLOR}" stroke-width="1"/>`;

  // ── Bars, value labels, date labels ──────────────────────────────────────
  const bars: string[] = [];
  const valueLabels: string[] = [];
  const dateLabels: string[] = [];

  series.forEach((item, i) => {
    const barH = maxVal === 0 ? 0 : Math.round((item.value / maxVal) * chartH);
    const x = PAD_LEFT + i * (barWidth + gap);
    const barY = baselineY - barH;

    // Bar (K-5b neutral fill)
    bars.push(
      `  <rect x="${x}" y="${barY}" width="${barWidth}" height="${barH}" fill="${BAR_FILL}" rx="2"/>`,
    );

    // Value label above bar — omit when barH === 0 to avoid overlap with baseline
    const valueLabelY = barH === 0 ? barY - 4 : barY - 4;
    valueLabels.push(
      `  <text x="${x + Math.round(barWidth / 2)}" y="${valueLabelY}" text-anchor="middle" fill="${VALUE_TEXT_COLOR}" font-family="sans-serif" font-size="10">${item.value}</text>`,
    );

    // X-axis date label — show "MM-DD" portion of a "YYYY-MM-DD" label (5 chars from index 5)
    // Keep raw string here; escSvg is applied once in the template below.
    const shortLabel = item.label.length >= 10 ? item.label.substring(5, 10) : item.label;
    const labelY = baselineY + 16;
    const labelX = x + Math.round(barWidth / 2);
    dateLabels.push(
      `  <text x="${labelX}" y="${labelY}" text-anchor="middle" fill="${MUTED_TEXT_COLOR}" font-family="sans-serif" font-size="10">${escSvg(shortLabel)}</text>`,
    );
  });

  // ── Caption ───────────────────────────────────────────────────────────────
  const captionLine = caption
    ? `  <text x="${Math.round(width / 2)}" y="${height - 4}" text-anchor="middle" fill="${MUTED_TEXT_COLOR}" font-family="sans-serif" font-size="11">${escSvg(caption)}</text>`
    : '';

  // ── Assemble ─────────────────────────────────────────────────────────────
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapedTitle}">`,
    `  <title>${escapedTitle}</title>`,
    baseline,
    ...bars,
    ...valueLabels,
    ...dateLabels,
  ];
  if (captionLine) lines.push(captionLine);
  lines.push('</svg>');

  return lines.join('\n');
}

// ─── kickCountChartSvg ────────────────────────────────────────────────────────

/** Input shape for kickCountChartSvg. */
export interface KickCountChartSession {
  /** Civil date "YYYY-MM-DD" used as the x-axis label. */
  date: string;
  /** Kick-count (movementCount) for this session. */
  count: number;
}

/** Options for kickCountChartSvg (passed through to barChartSvg). */
export interface KickCountChartOptions {
  noDataLabel?: string;
  caption?: string;
  width?: number;
  height?: number;
  title?: string;
}

/**
 * kickCountChartSvg — convenience wrapper around barChartSvg for kick sessions.
 *
 * Takes the already-filtered, already-sorted sessions (the assembler and preview
 * both apply the same filter/cap/sort before calling this) and returns the SVG.
 *
 * K-5b: delegates to barChartSvg; neutral ink is enforced there.
 */
export function kickCountChartSvg(
  sessions: KickCountChartSession[],
  options: KickCountChartOptions,
): string {
  return barChartSvg({
    series: sessions.map((s) => ({ label: s.date, value: s.count })),
    noDataLabel: options.noDataLabel,
    caption: options.caption,
    width: options.width,
    height: options.height,
    title: options.title,
  });
}
