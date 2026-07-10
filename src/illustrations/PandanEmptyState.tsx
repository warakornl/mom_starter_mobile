/**
 * PandanEmptyState — Solitary pandan frond for empty-state screens.
 *
 * Spec: docs/design/mother-room-build-spec.md §3.3
 *
 * Placement: Any first-run empty list screen (KickCount, Medication, Supplies).
 * Used in Phase 2 re-skin; created in Phase 1 per §5 shared-component rule.
 *
 * Dimensions: 64×96dp, viewBox="0 0 64 96"
 * Stroke: 1.5dp jade-600 #4A7A5C (lighter than hero — inviting rather than weighty)
 * Color prop defaults to color.text.secondary (#4A7A5C)
 * A11y: decorative — the empty-state Text component next to it carries the description.
 * Animation: static only (§3.3 — no animation on empty-state).
 * Node count: ≤40 path nodes total (§3.3 constraint).
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { T } from '../theme/tokens';

interface Props {
  /**
   * Optional stroke color override.
   * Default: color.text.secondary (#4A7A5C jade-600) — lighter, inviting.
   * §0 R4: jade-600 constraint (≥15sp for TEXT) does NOT apply to SVG strokes.
   */
  color?: string;
}

export function PandanEmptyState({ color = T.color.text.secondary }: Props): React.JSX.Element {
  // §3.3: Solitary pandan frond, single central rib (curved slightly left),
  // 6 pairs of tapering leaves (shorter near bottom, longer toward top).
  // Reads as a single living plant reaching upward. No flowers. No text.

  const sw = 1.5;
  const lc = 'round' as const;
  const lj = 'round' as const;
  const f  = 'none' as const;

  return (
    <Svg
      width={64}
      height={96}
      viewBox="0 0 64 96"
      fill="none"
      accessibilityElementsHidden={true}
      // @ts-ignore
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      {/* Central rib — curved slightly left, bottom to top */}
      <Path
        d="M32 94 C31 80 30 65 31 50 C32 35 30 20 31 6"
        stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f}
      />

      {/* Leaf pair 1 (bottom; y=85) — shortest, barely visible */}
      <Path d="M32 85 C24 83 20 80 24 76 C27 73 31 79 32 85" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M32 85 C40 83 44 80 40 76 C37 73 33 79 32 85" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Leaf pair 2 (y=70) — short */}
      <Path d="M31 70 C20 66 14 60 20 55 C25 51 30 63 31 70" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M31 70 C42 66 48 60 42 55 C37 51 32 63 31 70" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Leaf pair 3 (y=56) — medium */}
      <Path d="M31 56 C16 50 8 40 16 34 C22 29 30 47 31 56" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M31 56 C46 50 54 40 46 34 C40 29 32 47 31 56" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Leaf pair 4 (y=42) — medium-long */}
      <Path d="M31 42 C14 34 6 22 16 16 C22 11 30 32 31 42" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M31 42 C48 34 56 22 46 16 C40 11 32 32 31 42" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Leaf pair 5 (y=26) — long, spreading */}
      <Path d="M31 26 C16 18 8 8 18 4 C24 1 30 18 31 26"  stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M31 26 C46 18 54 8 44 4 C38 1 32 18 31 26"  stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

      {/* Leaf pair 6 (y=14) — longest, tapering to point (top of plant) */}
      <Path d="M31 14 C18 8 12 2 22 1 C28 0 31 10 31 14"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      <Path d="M31 14 C44 8 50 2 40 1 C34 0 31 10 31 14"   stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
    </Svg>
  );
}
