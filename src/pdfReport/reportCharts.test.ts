/**
 * reportCharts.test.ts — TDD for pure SVG chart string generators.
 *
 * These tests run in Node; no native APIs or canvas required.
 * All assertions are string-based (regex / contains).
 *
 * Spec invariants under test:
 *   - barChartSvg with N series items → N <rect> bars
 *   - Bar heights proportional to values (tallest count → max chartH)
 *   - Date labels present for each bar
 *   - Value labels above bars
 *   - Empty series → no-data text, no <rect> elements
 *   - Single data point → exactly 1 <rect>
 *   - Deterministic: same input → identical SVG string
 *   - K-5b: no red (#FF…) or green (#00…/#0F…) valence coloring
 *   - Returns a valid <svg>…</svg> root element
 *   - kickCountChartSvg delegates to barChartSvg (same output pattern)
 *   - caption line present when supplied
 *   - Empty kick-count chart renders no-data label not an error
 */

import { barChartSvg, kickCountChartSvg } from './reportCharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count occurrences of a substring in a string. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/** Extract numeric `height="..."` values from <rect> elements. */
function extractRectHeights(svg: string): number[] {
  const heights: number[] = [];
  const re = /<rect[^>]+height="(\d+(?:\.\d+)?)"[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    heights.push(parseFloat(m[1]));
  }
  return heights;
}

// ─── barChartSvg ──────────────────────────────────────────────────────────────

describe('barChartSvg', () => {
  // ── Basic structure ────────────────────────────────────────────────────────

  it('returns a string that starts with <svg and ends with </svg>', () => {
    const svg = barChartSvg({ series: [{ label: '2026-07-01', value: 5 }] });
    expect(typeof svg).toBe('string');
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg.trim()).toMatch(/<\/svg>$/);
  });

  it('includes xmlns attribute for valid SVG embedding in HTML', () => {
    const svg = barChartSvg({ series: [{ label: '2026-07-01', value: 5 }] });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('includes a <title> element for accessibility', () => {
    const svg = barChartSvg({
      series: [{ label: '2026-07-01', value: 5 }],
      title: 'Kick counts',
    });
    expect(svg).toContain('<title>Kick counts</title>');
  });

  // ── Bar count ──────────────────────────────────────────────────────────────

  it('renders exactly N <rect> bars for N data points', () => {
    const series = [
      { label: '2026-07-01', value: 8 },
      { label: '2026-07-02', value: 12 },
      { label: '2026-07-03', value: 5 },
    ];
    const svg = barChartSvg({ series });
    expect(countOccurrences(svg, '<rect')).toBe(3);
  });

  it('renders exactly 1 <rect> for a single data point', () => {
    const svg = barChartSvg({ series: [{ label: '2026-07-01', value: 10 }] });
    expect(countOccurrences(svg, '<rect')).toBe(1);
  });

  it('renders exactly 10 <rect> bars for 10 data points', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      label: `2026-07-${String(i + 1).padStart(2, '0')}`,
      value: i + 1,
    }));
    const svg = barChartSvg({ series });
    expect(countOccurrences(svg, '<rect')).toBe(10);
  });

  // ── Bar heights proportional to values ────────────────────────────────────

  it('tallest bar has the maximum chart height (proportional scaling)', () => {
    const series = [
      { label: '2026-07-01', value: 4 },
      { label: '2026-07-02', value: 8 },   // max
      { label: '2026-07-03', value: 2 },
    ];
    const svg = barChartSvg({ series });
    const heights = extractRectHeights(svg);
    expect(heights).toHaveLength(3);
    const maxHeight = Math.max(...heights);
    // The bar with value 8 should be the tallest
    expect(heights[1]).toBe(maxHeight);
  });

  it('bar heights are proportional: value 4 bar is 2x taller than value 2 bar', () => {
    const series = [
      { label: '2026-07-01', value: 2 },
      { label: '2026-07-02', value: 4 },
    ];
    const svg = barChartSvg({ series });
    const heights = extractRectHeights(svg);
    expect(heights).toHaveLength(2);
    // value-4 bar (index 1) should be double the value-2 bar (index 0)
    expect(heights[1]).toBe(heights[0] * 2);
  });

  it('all bars have height 0 when all values are 0', () => {
    const series = [
      { label: '2026-07-01', value: 0 },
      { label: '2026-07-02', value: 0 },
    ];
    const svg = barChartSvg({ series });
    const heights = extractRectHeights(svg);
    heights.forEach((h) => expect(h).toBe(0));
  });

  it('equal values produce equal-height bars', () => {
    const series = [
      { label: '2026-07-01', value: 7 },
      { label: '2026-07-02', value: 7 },
      { label: '2026-07-03', value: 7 },
    ];
    const svg = barChartSvg({ series });
    const heights = extractRectHeights(svg);
    const first = heights[0];
    heights.forEach((h) => expect(h).toBe(first));
  });

  // ── Date labels ───────────────────────────────────────────────────────────

  it('renders date label text for each data point', () => {
    const series = [
      { label: '2026-07-01', value: 5 },
      { label: '2026-07-15', value: 3 },
    ];
    const svg = barChartSvg({ series });
    // Each label's date portion (MM-DD or similar) should appear
    expect(svg).toContain('07-01');
    expect(svg).toContain('07-15');
  });

  // ── Value labels above bars ────────────────────────────────────────────────

  it('renders the numeric value above each bar', () => {
    const series = [
      { label: '2026-07-01', value: 8 },
      { label: '2026-07-02', value: 12 },
    ];
    const svg = barChartSvg({ series });
    expect(svg).toContain('>8<');
    expect(svg).toContain('>12<');
  });

  // ── Caption ────────────────────────────────────────────────────────────────

  it('includes the caption text when supplied', () => {
    const svg = barChartSvg({
      series: [{ label: '2026-07-01', value: 5 }],
      caption: '1 session · avg 5 movements',
    });
    expect(svg).toContain('1 session · avg 5 movements');
  });

  it('does not include a caption element when caption is not supplied', () => {
    const svg = barChartSvg({ series: [{ label: '2026-07-01', value: 5 }] });
    // No 'session' text without caption
    expect(svg).not.toContain('session');
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it('renders no <rect> elements for empty series', () => {
    const svg = barChartSvg({ series: [] });
    expect(svg).not.toContain('<rect');
  });

  it('renders the noDataLabel text for empty series', () => {
    const svg = barChartSvg({
      series: [],
      noDataLabel: 'No data in this range',
    });
    expect(svg).toContain('No data in this range');
  });

  it('still returns a valid <svg> root for empty series', () => {
    const svg = barChartSvg({ series: [] });
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg.trim()).toMatch(/<\/svg>$/);
  });

  it('uses a default noDataLabel when none is supplied and series is empty', () => {
    const svg = barChartSvg({ series: [] });
    // Should contain some fallback text (not crash, not empty SVG body)
    expect(svg).toMatch(/<text[^>]*>[^<]+<\/text>/);
  });

  // ── K-5b: No valence coloring ──────────────────────────────────────────────

  it('K-5b: does not use red fill color on bars', () => {
    const series = [
      { label: '2026-07-01', value: 3 },
      { label: '2026-07-02', value: 10 },
    ];
    const svg = barChartSvg({ series });
    // No red-family fills (#F.. starting with high red component)
    // Check specifically for common "bad" red values
    expect(svg).not.toMatch(/fill="#[Ff][Ff]0000"/);
    expect(svg).not.toMatch(/fill="red"/i);
    expect(svg).not.toMatch(/fill="#[Ee][Ff]4444"/);
    expect(svg).not.toMatch(/fill="#[Dd][Cc]2626"/);
  });

  it('K-5b: does not use green fill color on bars', () => {
    const series = [
      { label: '2026-07-01', value: 3 },
      { label: '2026-07-02', value: 10 },
    ];
    const svg = barChartSvg({ series });
    expect(svg).not.toMatch(/fill="green"/i);
    expect(svg).not.toMatch(/fill="#00[Ff][Ff]00"/);
    expect(svg).not.toMatch(/fill="#22[Cc]55[Ee]/);
  });

  // ── Determinism ───────────────────────────────────────────────────────────

  it('is deterministic: same input produces identical output', () => {
    const series = [
      { label: '2026-07-01', value: 8 },
      { label: '2026-07-02', value: 12 },
      { label: '2026-07-03', value: 5 },
    ];
    const svg1 = barChartSvg({ series, caption: '3 sessions · avg 8', title: 'Kick counts' });
    const svg2 = barChartSvg({ series, caption: '3 sessions · avg 8', title: 'Kick counts' });
    expect(svg1).toBe(svg2);
  });

  // ── HTML safety ───────────────────────────────────────────────────────────

  it('escapes < > & " in label values to prevent SVG injection', () => {
    const svg = barChartSvg({
      series: [{ label: '<script>', value: 5 }],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('escapes special chars in caption', () => {
    const svg = barChartSvg({
      series: [{ label: '2026-07-01', value: 1 }],
      caption: 'avg > 10 & < 20',
    });
    expect(svg).not.toContain('avg > 10 & < 20');
    expect(svg).toContain('avg &gt; 10 &amp; &lt; 20');
  });

  // ── Baseline ──────────────────────────────────────────────────────────────

  it('includes a <line> baseline element', () => {
    const svg = barChartSvg({ series: [{ label: '2026-07-01', value: 5 }] });
    expect(svg).toContain('<line');
  });
});

// ─── kickCountChartSvg ────────────────────────────────────────────────────────

describe('kickCountChartSvg', () => {
  it('returns a valid SVG for kick sessions', () => {
    const sessions = [
      { date: '2026-07-01', count: 8 },
      { date: '2026-07-02', count: 12 },
    ];
    const svg = kickCountChartSvg(sessions, {});
    expect(svg.trim()).toMatch(/^<svg /);
    expect(svg.trim()).toMatch(/<\/svg>$/);
  });

  it('renders N bars for N sessions', () => {
    const sessions = [
      { date: '2026-07-01', count: 8 },
      { date: '2026-07-02', count: 12 },
      { date: '2026-07-03', count: 5 },
    ];
    const svg = kickCountChartSvg(sessions, {});
    expect(countOccurrences(svg, '<rect')).toBe(3);
  });

  it('renders the count values as text labels', () => {
    const sessions = [
      { date: '2026-07-01', count: 8 },
      { date: '2026-07-02', count: 12 },
    ];
    const svg = kickCountChartSvg(sessions, {});
    expect(svg).toContain('>8<');
    expect(svg).toContain('>12<');
  });

  it('renders no <rect> for empty sessions', () => {
    const svg = kickCountChartSvg([], { noDataLabel: 'ไม่มีข้อมูลในช่วงนี้' });
    expect(svg).not.toContain('<rect');
    expect(svg).toContain('ไม่มีข้อมูลในช่วงนี้');
  });

  it('renders exactly 1 bar for a single session', () => {
    const svg = kickCountChartSvg([{ date: '2026-07-01', count: 10 }], {});
    expect(countOccurrences(svg, '<rect')).toBe(1);
  });

  it('includes caption when provided', () => {
    const svg = kickCountChartSvg(
      [{ date: '2026-07-01', count: 8 }],
      { caption: '1 session · avg 8 movements' },
    );
    expect(svg).toContain('1 session · avg 8 movements');
  });

  it('is deterministic for same session input', () => {
    const sessions = [
      { date: '2026-07-01', count: 8 },
      { date: '2026-07-02', count: 12 },
    ];
    const svg1 = kickCountChartSvg(sessions, { caption: '2 sessions' });
    const svg2 = kickCountChartSvg(sessions, { caption: '2 sessions' });
    expect(svg1).toBe(svg2);
  });

  it('K-5b: uses neutral (non-valenced) bar fill', () => {
    const sessions = [
      { date: '2026-07-01', count: 8 },
      { date: '2026-07-02', count: 12 },
    ];
    const svg = kickCountChartSvg(sessions, {});
    // Must not contain red or green fills
    expect(svg).not.toMatch(/fill="(red|green)"/i);
    expect(svg).not.toMatch(/fill="#[Ff][Ff]0000"/);
    expect(svg).not.toMatch(/fill="#00[Ff][Ff]00"/);
  });
});
