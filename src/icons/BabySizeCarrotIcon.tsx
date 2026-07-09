/**
 * BabySizeCarrotIcon — wk 21 (แครอท)
 *
 * Shape: tapered root with three feathery greens at top.
 * Tapered wedge + three spreading leaf-lines is unmistakably carrot.
 * Design: baby-size-home-section.md §5 "BabySizeCarrotIcon"
 */
import React from 'react';
import Svg, { Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeCarrotIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: tapered root */}
      <Path
        d="M10 6 C8 10 8 15 10 21 C11 23 13 23 14 21 C16 15 16 10 14 6 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Three spreading greens */}
      <Line x1="12" y1="6" x2="10" y2="2" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="12" y1="6" x2="12" y2="1" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="12" y1="6" x2="14" y2="2" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </Svg>
  );
}
