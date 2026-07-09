/**
 * BabySizeCornIcon — wks 23–24 (ข้าวโพด)
 *
 * Shape: corn ear with husk leaves, kernel row lines, and silk tassel.
 * Rectangle + row lines + tassel is unmistakably corn.
 * Design: baby-size-home-section.md §5 "BabySizeCornIcon"
 */
import React from 'react';
import Svg, { Line, Path, Rect } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeCornIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Ear body */}
      <Rect
        x="8"
        y="5"
        width="8"
        height="14"
        rx="2"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Kernel row lines */}
      <Line x1="8" y1="9"  x2="16" y2="9"  stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="8" y1="13" x2="16" y2="13" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Line x1="8" y1="17" x2="16" y2="17" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      {/* Silk tassel */}
      <Path
        d="M10 5 C10 2 11 1 12 1 C13 1 14 2 14 5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Husk wraps */}
      <Path d="M8 15 C5 13 5 8 8 7"  stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 15 C19 13 19 8 16 7" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
