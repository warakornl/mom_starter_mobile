/**
 * BabySizeStrawberryIcon — wk 10 (สตรอว์เบอร์รี่)
 *
 * Shape: heart-triangle body + seed dots + sepal crown.
 * Pointed-bottom rounded triangle with seeds is unmistakably strawberry.
 * Design: baby-size-home-section.md §5 "BabySizeStrawberryIcon"
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeStrawberryIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: heart-triangle */}
      <Path
        d="M12 21 C7 18 4 13 5 8 C6 4 9 2 12 2 C15 2 18 4 19 8 C20 13 17 18 12 21 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Seed dots */}
      <Circle cx="10" cy="10" r="0.8" fill={color} />
      <Circle cx="13" cy="12" r="0.8" fill={color} />
      <Circle cx="10" cy="15" r="0.8" fill={color} />
      {/* Sepal crown */}
      <Path
        d="M9 3 C9 1 10 0 12 2 C14 0 15 1 15 3"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
