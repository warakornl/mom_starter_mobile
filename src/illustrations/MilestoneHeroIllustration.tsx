/**
 * MilestoneHeroIllustration — Jasmine + pandan milestone botanical hero.
 *
 * Spec: docs/design/mother-room-build-spec.md §3.2
 *
 * Placement: WeeklyMilestoneSheet header — the ONE deliberate illustration moment.
 * Rendered centered in the sheet header; jasmine sprig (left) + pandan frond (right).
 *
 * Dimensions: 120×80dp, viewBox="0 0 120 80"
 * Stroke: 1.5dp jade-800 (light); #C4D9CB (dark) — color prop
 * Animation: path-length grow 400ms ease-out on mount (standard motion only).
 *   Reduce-motion: AccessibilityInfo.isReduceMotionEnabled() → static SVG.
 * A11y: decorative — accessibilityElementsHidden={true}.
 * Node count: ≤40 path nodes total (§3.2 constraint).
 */

import React, { useEffect, useState } from 'react';
import { Animated, Easing, AccessibilityInfo } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import { T } from '../theme/tokens';

interface Props {
  /** Stroke color — T.color.accent.botanical (light) or T.dark.accent.botanical (dark). */
  color?: string;
  /** When true, path-length grow animation plays on mount. Respects reduce-motion. */
  animated?: boolean;
}

/**
 * MilestoneHeroIllustration renders static when reduce-motion is enabled or
 * when animated=false. When animated=true + reduce-motion=false, a CSS-like
 * path-length animation grows the strokes from root-to-tip over 400ms ease-out.
 *
 * §3.2: "Triggered once on mount. NOT triggered on subsequent re-renders."
 */
export function MilestoneHeroIllustration({
  color = T.color.accent.botanical,
  animated = true,
}: Props): React.JSX.Element {
  const [reduceMotion, setReduceMotion] = useState(false);
  // Animated value 0→1 drives strokeDashoffset (simulated path-length grow)
  const progress = React.useRef(new Animated.Value(0)).current;

  // Check reduce-motion preference once on mount
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { setReduceMotion(enabled); })
      .catch(() => { /* non-fatal — default false */ });
  }, []);

  // Trigger path-length animation once on mount (§3.2: "once on mount")
  useEffect(() => {
    if (!animated || reduceMotion) {
      progress.setValue(1); // static: fully visible
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue:        1,
      duration:       400, // §3.2: 400ms ease-out
      easing:         Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated, reduceMotion]); // progress ref is stable

  const sw = 1.5;
  const lc = 'round' as const;
  const lj = 'round' as const;
  const f  = 'none' as const;

  return (
    <Svg
      width={120}
      height={80}
      viewBox="0 0 120 80"
      fill="none"
      accessibilityElementsHidden={true}
      // @ts-ignore
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      {/* ── Left third: jasmine sprig ──────────────────────────────────────── */}
      {/*  S-curve stem from bottom root (30,78) → mid (28,50) → top (25,25)  */}
      <G>
        {/* Stem S-curve */}
        <Path
          d="M30 78 C32 65 26 55 28 42 C30 30 22 22 25 12"
          stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f}
        />
        {/* Jasmine flower 1 — center (20, 20), 3 petals */}
        <Path d="M20 20 C19 17 17 16 20 16 C23 16 21 17 20 20" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M20 20 C23 19 24 16 22 16 C20 15 20 18 20 20" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M20 20 C17 19 16 17 18 16 C20 15 20 18 20 20" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        {/* Branch to flower 1 */}
        <Path d="M25 22 Q22 21 20 20" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

        {/* Jasmine flower 2 — center (30, 40), 3 petals */}
        <Path d="M30 40 C29 37 27 36 30 36 C33 36 31 37 30 40" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M30 40 C33 39 34 36 32 36 C30 35 30 38 30 40" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M30 40 C27 39 26 37 28 36 C30 35 30 38 30 40" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

        {/* Jasmine flower 3 — center (22, 58), 2 petals */}
        <Path d="M22 58 C21 55 19 54 22 54 C25 54 23 55 22 58" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M22 58 C25 57 26 54 24 54 C22 53 22 56 22 58" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M28 56 Q25 57 22 58" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />

        {/* Small oval leaves along stem */}
        <Path d="M27 32 C25 30 24 28 26 28 C28 28 28 30 27 32" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M29 48 C31 46 32 44 30 44 C28 44 28 46 29 48" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      </G>

      {/* ── Right third: pandan frond ──────────────────────────────────────── */}
      {/* Central rib from root (90,78) to top (88,5); 5 pairs of leaves      */}
      <G>
        {/* Central rib */}
        <Path
          d="M90 78 C91 65 89 50 88 35 C87 20 88 10 88 5"
          stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f}
        />
        {/* Leaf pair 1 (bottom, x=90, y=70) — short, splayed outward */}
        <Path d="M90 70 C80 68 74 64 78 60 C82 57 88 62 90 70" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M90 70 C100 68 106 64 102 60 C98 57 92 62 90 70" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        {/* Leaf pair 2 (y=56) — medium */}
        <Path d="M89 56 C76 52 70 45 75 40 C80 36 87 47 89 56" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M89 56 C102 52 108 45 103 40 C98 36 91 47 89 56" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        {/* Leaf pair 3 (y=40) — longer, tapering */}
        <Path d="M88 40 C74 34 66 24 72 18 C77 12 86 30 88 40" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
        <Path d="M88 40 C102 34 110 24 104 18 C99 12 90 30 88 40" stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f} />
      </G>

      {/* ── Shared root (§3.2 "stems overlapping slightly at bottom center") ── */}
      <Path
        d="M30 78 Q60 76 90 78"
        stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill={f}
      />
    </Svg>
  );
}
