/**
 * BabySizeWatermelonIcon — wks 37–39 (แตงโม)
 *
 * Shape: horizontal oval body + vertical curved stripes.
 * Horizontal oval + vertical curved stripes is the iconic watermelon pattern.
 * Design: baby-size-home-section.md §5 "BabySizeWatermelonIcon"
 */
import React from 'react';
import Svg, { Ellipse, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeWatermelonIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: horizontal oval */}
      <Ellipse
        cx="12"
        cy="12"
        rx="10"
        ry="8"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Vertical stripe paths */}
      <Path d="M8  4 C7  6 7  18 8  20" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 4 C11 6 11 18 12 20" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 4 C17 6 17 18 16 20" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4  12 C6 8 18 8 20 12"  stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
