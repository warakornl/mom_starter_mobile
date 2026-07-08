/**
 * KickCountDailyChart — vertical bar chart for per-day kick-movement totals.
 *
 * Renders using react-native-svg (already installed).
 *
 * Design (Direction C "Clean"):
 *   - Rose bars (T.rose #A8505A), flat — no shadow, no gradient.
 *   - Hairline baseline (T.hairline #E3D8CE).
 *   - Ink labels (#1A1A1A).
 *   - Generous whitespace, minimal chrome.
 *   - Y axis scaled to max daily total. All-zero → empty-state text, no broken axis.
 *   - X labels = day-of-month number, thinned when range is long.
 *
 * Accessibility:
 *   - The outer View has an accessibilityLabel summarising the chart (screen reader).
 *   - The SVG bars are decorative (aria-hidden equivalent: no individual bar labels
 *     are announced — only the summary label).
 *
 * K-8 compliance:
 *   - NEVER log any session or movementCount data.
 *   - Receives only pre-aggregated DailyKickTotal[] — no raw session fields.
 *
 * SD-9 compliance:
 *   - No health data in props beyond the pre-aggregated chart series.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line, Text as SvgText, G } from 'react-native-svg';
import type { DailyKickTotal } from './kickCountDailyTotals';
import { interpolate } from '../i18n/messages';

// ─── Design tokens ────────────────────────────────────────────────────────────

/** Rose bar fill — T.rose. Exported for token tests. */
export const CHART_ROSE_FILL = '#A8505A';

/** Hairline baseline / axis color — T.hairline. Exported for token tests. */
export const CHART_HAIRLINE = '#E3D8CE';

/** Ink text color. Exported for token tests. */
export const CHART_INK = '#1A1A1A';

/** Ink-soft text color for axes and thinned labels. */
const CHART_INK_SOFT = '#6B6B6B';

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAD_LEFT = 4;
const PAD_RIGHT = 4;
const PAD_TOP = 20;    // space for value label above tallest bar
const PAD_BOTTOM = 24; // space for x-axis day labels
const BAR_GAP_RATIO = 0.3; // fraction of slot width used as gap between bars

// ─── Props ────────────────────────────────────────────────────────────────────

export interface KickCountDailyChartProps {
  /** Pre-aggregated daily totals from buildDailyKickTotals. */
  data: DailyKickTotal[];
  /** Chart width in pixels (pass from onLayout or a fixed value). */
  width: number;
  /** Chart height in pixels. Default: 180. */
  height?: number;
  /** A11y chart label template — uses kick.chartA11y pattern from caller. */
  accessibilityLabel?: string;
  /** Text to show when all data is empty (kick.chartEmpty from caller). */
  emptyLabel?: string;
}

// ─── Helper: niceMax ─────────────────────────────────────────────────────────

/**
 * Compute a "nice" Y-axis maximum that is slightly above the raw max.
 * If rawMax is 0, returns 1 (so the axis is at least 1 tall).
 */
function niceMax(rawMax: number): number {
  if (rawMax <= 0) return 1;
  if (rawMax <= 5) return rawMax + 1;
  // Round up to the nearest 5
  return Math.ceil((rawMax + 1) / 5) * 5;
}

// ─── Helper: thin x-labels ────────────────────────────────────────────────────

/**
 * Return the step N so that at most ~10 x-axis labels are shown.
 * For 7 days → step 1 (all shown).
 * For 30 days → step 3 (every 3rd shown).
 */
function labelStep(barCount: number): number {
  if (barCount <= 10) return 1;
  if (barCount <= 20) return 2;
  if (barCount <= 40) return 4;
  return 7;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KickCountDailyChart({
  data,
  width,
  height = 180,
  accessibilityLabel,
  emptyLabel = 'No data for this period',
}: KickCountDailyChartProps): React.ReactElement {
  const chartW = width - PAD_LEFT - PAD_RIGHT;
  const chartH = height - PAD_TOP - PAD_BOTTOM;

  const n = data.length;
  const maxTotal = n > 0 ? Math.max(...data.map((d) => d.totalCount)) : 0;
  const yMax = niceMax(maxTotal);
  const allZero = maxTotal === 0;
  const step = labelStep(n);

  // Slot width per bar
  const slotW = n > 0 ? chartW / n : chartW;
  const barW = slotW * (1 - BAR_GAP_RATIO);
  const barOffsetX = (slotW - barW) / 2;

  // Baseline Y position in SVG coordinates
  const baselineY = PAD_TOP + chartH;

  return (
    <View
      style={styles.container}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
    >
      {/* Empty-state overlay */}
      {allZero && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <Text style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      )}

      <Svg width={width} height={height}>
        {/* Hairline baseline */}
        <Line
          x1={PAD_LEFT}
          y1={baselineY}
          x2={PAD_LEFT + chartW}
          y2={baselineY}
          stroke={CHART_HAIRLINE}
          strokeWidth={1}
        />

        {/* Bars + x labels */}
        {data.map((day, i) => {
          const barH = allZero
            ? 0
            : Math.max(2, (day.totalCount / yMax) * chartH);
          const barX = PAD_LEFT + i * slotW + barOffsetX;
          const barY = baselineY - barH;

          // X label: day-of-month (e.g. "5" from "2026-07-05")
          const dayNum = day.date.slice(8); // "DD"
          const showLabel = i % step === 0;
          const labelX = PAD_LEFT + i * slotW + slotW / 2;

          return (
            <G key={day.date}>
              {/* Rose bar — decorative (no per-bar a11y announcement) */}
              {day.totalCount > 0 && (
                <Rect
                  x={barX}
                  y={barY}
                  width={barW}
                  height={barH}
                  fill={CHART_ROSE_FILL}
                  rx={2}
                  ry={2}
                />
              )}

              {/* X-axis day label (thinned) */}
              {showLabel && (
                <SvgText
                  x={labelX}
                  y={baselineY + 14}
                  fontSize={9}
                  fill={CHART_INK_SOFT}
                  textAnchor="middle"
                >
                  {dayNum}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  emptyText: {
    fontSize: 13,
    color: CHART_INK_SOFT,
    textAlign: 'center',
  },
});

// ─── Helper export for screen: build a11y label ───────────────────────────────

/**
 * Build the accessibility label for the chart using the kick.chartA11y template.
 * Exported so KickCountHistoryScreen can call it with the current locale's string.
 *
 * K-8: only the pre-aggregated {n} and {max} values are used — no raw session data.
 */
export function buildChartA11yLabel(
  template: string,
  n: number,
  max: number,
): string {
  return interpolate(template, { n, max });
}
