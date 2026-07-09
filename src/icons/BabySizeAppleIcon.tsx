/**
 * BabySizeAppleIcon — wks 14–15 (แอปเปิ้ล)
 *
 * Shape: apple body with top notch, stem, and leaf.
 * Heart-shaped top notch is the most distinctive apple silhouette feature.
 * Design: baby-size-home-section.md §5 "BabySizeAppleIcon"
 */
import React from 'react';
import Svg, { Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeAppleIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: apple with top notch */}
      <Path
        d="M5 10 C4 6 7 3 10 3 C10 1 14 1 14 3 C17 3 20 6 19 10 C18 17 15 21 12 21 C9 21 6 17 5 10 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Stem */}
      <Line
        x1="12"
        y1="3"
        x2="12"
        y2="1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Leaf */}
      <Path
        d="M12 1.5 C14 0 17 1 16 3"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
