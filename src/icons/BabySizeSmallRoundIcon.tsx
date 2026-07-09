/**
 * BabySizeSmallRoundIcon — wks 5–9, 11–13 (seed/lentil/blueberry/grape/cherry/lime/lemon)
 *
 * Shape: plain smooth round circle + short stem. Deliberately minimal so Thai
 * NAME + size number do the distinguishing work across small round fruits/seeds.
 * Design: baby-size-home-section.md §5 "BabySizeSmallRoundIcon"
 */
import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeSmallRoundIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: smooth round circle */}
      <Circle
        cx="12"
        cy="13"
        r="7"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Short stem */}
      <Line
        x1="12"
        y1="6"
        x2="12"
        y2="4"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
