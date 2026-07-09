/**
 * BabySizePineappleIcon — wks 25, 32–33 (สับปะรด)
 *
 * Shape: oval body with diamond crosshatch + three crown spikes.
 * Most complex silhouette in the set — unmistakable pineapple.
 * Design: baby-size-home-section.md §5 "BabySizePineappleIcon"
 */
import React from 'react';
import Svg, { Ellipse, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizePineappleIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: oval */}
      <Ellipse
        cx="12"
        cy="16"
        rx="7"
        ry="8"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Diamond crosshatch */}
      <Line x1="8"  y1="12" x2="16" y2="20" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="16" y1="12" x2="8"  y2="20" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="8"  y1="16" x2="16" y2="16" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="12" y1="8"  x2="12" y2="24" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      {/* Crown: 3 spikes */}
      <Line x1="12" y1="8" x2="12" y2="2" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="9"  y1="8" x2="7"  y2="2" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="15" y1="8" x2="17" y2="2" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </Svg>
  );
}
