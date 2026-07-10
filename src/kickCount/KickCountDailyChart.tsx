/**
 * KickCountDailyChart — vertical bar chart for per-day kick-movement totals.
 *
 * Renders using react-native-svg (already installed).
 *
 * Design (ห้องแม่ Phase 2):
 *   - Amber-600 bars (T.color.accent.milestone #B8720E), flat — no shadow, no gradient.
 *   - Divider baseline (T.color.surface.divider #E8DDD5).
 *   - Roselle-700 labels (T.color.text.primary #7A3A52) — type.micro 11sp.
 *   - Generous whitespace, minimal chrome.
 *   - Y axis scaled to max daily total. All-zero → empty-state text, no broken axis.
 *   - X labels = day-of-month number, thinned when range is long.
 *
 * K-5b note: Chart bars must not use different colours at different count values
 *   (no "red zone" at low counts, no "green zone" at high counts).
 *   All bars use accent.milestone amber-600 uniformly.
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
import { T } from '../theme/tokens';

// ─── Design token constants (exported for token tests per F-5 note) ───────────

/**
 * Amber-600 bar fill — T.color.accent.milestone.
 * K-5b: uniform across ALL bars regardless of count value.
 * Exported as a hex string per F-5 note (chart libraries need explicit hex).
 */
export const CHART_AMBER_FILL = T.color.accent.milestone;  // '#B8720E'

/**
 * Divider baseline / axis color — T.color.surface.divider.
 * Exported for token tests.
 */
export const CHART_DIVIDER = T.color.surface.divider;      // '#E8DDD5'

/**
 * Primary text color for axis labels — T.color.text.primary roselle-700.
 * Exported for token tests.
 */
export const CHART_LABEL_COLOR = T.color.text.primary;     // '#7A3A52'

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
        {/* Divider baseline — T.color.surface.divider */}
        <Line
          x1={PAD_LEFT}
          y1={baselineY}
          x2={PAD_LEFT + chartW}
          y2={baselineY}
          stroke={CHART_DIVIDER}
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
              {/*
                Amber-600 bar — decorative (no per-bar a11y announcement).
                K-5b: CHART_AMBER_FILL is constant — same for ALL bars regardless
                of totalCount value. No "red zone", no "green zone".
              */}
              {day.totalCount > 0 && (
                <Rect
                  x={barX}
                  y={barY}
                  width={barW}
                  height={barH}
                  fill={CHART_AMBER_FILL}
                  rx={2}
                  ry={2}
                />
              )}

              {/* X-axis day label (thinned) — type.micro roselle-700 */}
              {showLabel && (
                <SvgText
                  x={labelX}
                  y={baselineY + 14}
                  fontSize={T.type.micro.size}   // 11sp
                  fill={CHART_LABEL_COLOR}        // #7A3A52 roselle-700
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
    backgroundColor: T.color.surface.base,        // #FBF6F1 ivory-100 — chart bg
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
    fontFamily: T.type.caption.fontFamily,        // Sarabun-Regular
    fontSize: T.type.caption.size,                // 13sp
    lineHeight: T.type.caption.lineHeight,        // 21
    color: T.color.text.primary,                  // #7A3A52 roselle-700 (from CHART_INK_SOFT #6B6B6B)
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
