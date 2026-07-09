/**
 * BabySizePapayaIcon — wks 22, 26, 36 (มะละกอ)
 *
 * Shape: tall elongated oval body + stem + two spreading wing-leaves at top.
 * Tall oval + two spreading wing-leaves is distinctly papaya.
 * Reused at wks 22 (small), 26 (medium), 36 (large) — Thai copy clarifies size.
 * Design: baby-size-home-section.md §5 "BabySizePapayaIcon"
 */
import React from 'react';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizePapayaIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: tall elongated oval */}
      <Ellipse
        cx="12"
        cy="15"
        rx="6"
        ry="9"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Stem */}
      <Line x1="12" y1="6" x2="12" y2="4" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      {/* Left wing leaf */}
      <Path
        d="M12 5 C9 3 6 4 7 7 C8 5 10 4 12 5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right wing leaf */}
      <Path
        d="M12 5 C15 3 18 4 17 7 C16 5 14 4 12 5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
