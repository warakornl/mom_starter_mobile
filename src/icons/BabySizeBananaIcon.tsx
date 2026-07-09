/**
 * BabySizeBananaIcon — wk 20 (กล้วยหอม)
 *
 * Shape: curved crescent arc — the most distinctive fruit silhouette in the set.
 * Cannot be confused with any other icon.
 * Design: baby-size-home-section.md §5 "BabySizeBananaIcon"
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeBananaIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: curved crescent arc */}
      <Path
        d="M4 19 C4 15 6 9 10 5 C14 1 19 2 20 6 C18 8 15 7 12 9 C9 11 8 15 7 19 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
