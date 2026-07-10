/**
 * JasmineDivider — Jasmine stem-and-flowers section divider.
 *
 * Spec: docs/design/mother-room-build-spec.md §3.1
 *
 * Placement: HomeTabScreen — between week-hero and baby-size subtitle.
 * Replaces the generic hairline. The jasmine (ดอกมะลิ) motif holds dual
 * cultural meaning in Thai culture (purity + comfort — appropriate in
 * both celebration and loss states).
 *
 * Dimensions: 80×12dp, viewBox="0 0 80 12"
 * Stroke: 1.5dp jade-800 #2F5042 (light); #C4D9CB (dark) — passed via color prop
 * A11y: decorative — accessibilityElementsHidden={true}, hidden from SR tree.
 * Animation: static only (§3.1 — reduce-motion moot; no animation defined here).
 * Node count: ≤40 path nodes total (§3.1 constraint).
 */

import React from 'react';
import Svg, { Path, Line } from 'react-native-svg';
import { T } from '../theme/tokens';

interface Props {
  /** Stroke color — caller passes T.color.accent.botanical (light) or T.dark.accent.botanical (dark). */
  color?: string;
}

export function JasmineDivider({ color = T.color.accent.botanical }: Props): React.JSX.Element {
  // §3.1: horizontal stem from x=2 to x=78 at y=9 (bottom of 12dp box)
  // Two jasmine flower clusters, each with 5 petals (smooth teardrop ovals)
  // Left flower center: (20, 4); right flower center: (60, 4)
  // Leaves: one small elongated leaf each side of stem at x=28±10, x=52±10
  // All stroke: strokeWidth=1.5, strokeLinecap=round, strokeLinejoin=round, fill=none
  // Total path elements: 2 stems + 2 × (5 petals + 2 leaves) = 2 + 14 = 16 elements ≤ 40 ✓

  const sw = 1.5;
  const lc = 'round' as const;
  const lj = 'round' as const;
  const f = 'none' as const;

  return (
    <Svg
      width={80}
      height={12}
      viewBox="0 0 80 12"
      fill="none"
      // §3.1 A11y: decorative — hidden from screen reader tree
      accessibilityElementsHidden={true}
      // @ts-ignore — React Native SVG aria-hidden prop (cross-platform a11y)
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      {/* Main horizontal stem */}
      <Line
        x1={2} y1={9} x2={78} y2={9}
        stroke={color} strokeWidth={sw} strokeLinecap={lc}
      />

      {/* Left branch up to flower (x=20, y=4) */}
      <Path
        d="M20 9 Q20 6 20 4"
        stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f}
      />

      {/* Left jasmine: 5 petals around center (20, 4) — teardrop ovals */}
      <Path d="M20 4 C19 2 18 1 20 1 C22 1 21 2 20 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M20 4 C22 3 23 1 21 1 C20 1 20 3 20 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M20 4 C22 5 23 7 21 7 C20 6 20 5 20 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M20 4 C18 5 17 7 19 7 C20 6 20 5 20 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M20 4 C18 3 17 1 19 1 C20 1 20 3 20 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Left leaf pair (§3.1: one on each side at x=28–x=32) */}
      <Path d="M30 9 C29 7 28 6 30 6 C32 6 31 7 30 9"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Right branch up to flower (x=60, y=4) */}
      <Path
        d="M60 9 Q60 6 60 4"
        stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f}
      />

      {/* Right jasmine: 5 petals around center (60, 4) */}
      <Path d="M60 4 C59 2 58 1 60 1 C62 1 61 2 60 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M60 4 C62 3 63 1 61 1 C60 1 60 3 60 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M60 4 C62 5 63 7 61 7 C60 6 60 5 60 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M60 4 C58 5 57 7 59 7 C60 6 60 5 60 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M60 4 C58 3 57 1 59 1 C60 1 60 3 60 4"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Right leaf pair */}
      <Path d="M50 9 C49 7 48 6 50 6 C52 6 51 7 50 9"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
    </Svg>
  );
}
