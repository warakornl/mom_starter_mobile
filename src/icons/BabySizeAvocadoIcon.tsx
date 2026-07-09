/**
 * BabySizeAvocadoIcon — wk 16 (อโวคาโด)
 *
 * Shape: half avocado cross-section showing outer skin and pit.
 * D-shape outline with prominently-placed large pit is uniquely avocado.
 * Design: baby-size-home-section.md §5 "BabySizeAvocadoIcon"
 */
import React from 'react';
import Svg, { Ellipse, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeAvocadoIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Outer shell */}
      <Path
        d="M12 2 C7 2 4 8 4 13 C4 19 8 22 12 22 C16 22 20 19 20 13 C20 8 17 2 12 2 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Large oval pit */}
      <Ellipse
        cx="12"
        cy="15"
        rx="4"
        ry="5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
