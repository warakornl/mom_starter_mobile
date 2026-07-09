/**
 * BabySizeSquashIcon — wks 29–30 (น้ำเต้า / bottle gourd)
 *
 * Shape: two-bulb gourd (figure-8). Narrow neck at top, wide rounded body.
 * Figure-8 / hourglass silhouette matches น้ำเต้า (bottle gourd) perfectly.
 * Name change: ฟักบัตเตอร์นัต → น้ำเต้า; icon shape unchanged.
 * Design: baby-size-home-section.md §5 "BabySizeSquashIcon"
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeSquashIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Top bulb (smaller) */}
      <Path
        d="M10 2 C8 2 7 4 7 7 C7 10 9 11 12 11 C15 11 17 10 17 7 C17 4 16 2 14 2 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom bulb (larger) */}
      <Path
        d="M9 11 C6 12 4 15 4 19 C4 22 7 24 12 24 C17 24 20 22 20 19 C20 15 18 12 15 11 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
