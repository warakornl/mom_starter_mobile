/**
 * BabySizePearIcon — wk 17 (ลูกแพร์)
 *
 * Shape: pear silhouette — narrow top swelling into round bottom + short stem.
 * Dramatic waist (narrow shoulder → wide round bottom) is distinct from mango.
 * Design: baby-size-home-section.md §5 "BabySizePearIcon"
 */
import React from 'react';
import Svg, { Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizePearIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Pear body: narrow top, wide round bottom */}
      <Path
        d="M12 2 C10 2 9 5 9 8 C7 9 4 12 4 16 C4 20 8 22 12 22 C16 22 20 20 20 16 C20 12 17 9 15 8 C15 5 14 2 12 2 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Short stem */}
      <Line
        x1="12"
        y1="2"
        x2="12"
        y2="0"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
