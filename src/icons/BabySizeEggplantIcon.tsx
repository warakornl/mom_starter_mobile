/**
 * BabySizeEggplantIcon — wks 27–28 (มะเขือม่วง)
 *
 * Shape: bottom-heavy teardrop body + V-calyx cap + stem.
 * Bottom-heavy teardrop + V-calyx is distinctly eggplant.
 * Design: baby-size-home-section.md §5 "BabySizeEggplantIcon"
 */
import React from 'react';
import Svg, { Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeEggplantIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: teardrop */}
      <Path
        d="M12 8 C8 8 5 12 5 16 C5 20 8 23 12 23 C16 23 19 20 19 16 C19 12 16 8 12 8 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Calyx */}
      <Path
        d="M9 8 C9 5 10 4 12 4 C14 4 15 5 15 8"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Stem */}
      <Line
        x1="12"
        y1="4"
        x2="12"
        y2="2"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
