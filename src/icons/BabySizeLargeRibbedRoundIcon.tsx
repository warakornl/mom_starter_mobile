/**
 * BabySizeLargeRibbedRoundIcon — wks 31, 34–35, 40 (มะพร้าว / แตงไทย / ฟักทอง)
 *
 * Shape: large round circle + four curved rib lines + short stub stem.
 * Generically "large ribbed round produce." Thai NAME distinguishes the fruit.
 * Replaces separate coconut / melon / pumpkin icons (all collapse at 24–28dp).
 * Design: baby-size-home-section.md §5 "BabySizeLargeRibbedRoundIcon"
 */
import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeLargeRibbedRoundIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: large round circle */}
      <Circle
        cx="12"
        cy="12"
        r="9"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Four curved rib lines */}
      <Path d="M12 3 C8 5 5 9 5 12 C5 15 8 19 12 21"  stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 3 C16 5 19 9 19 12 C19 15 16 19 12 21" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 12 C5 8 9 5 12 5 C15 5 19 8 21 12"  stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 12 C5 16 9 19 12 19 C15 19 19 16 21 12" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {/* Short stub stem */}
      <Line
        x1="12"
        y1="3"
        x2="12"
        y2="1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
