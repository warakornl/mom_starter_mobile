/**
 * BabySizeMangoIcon — wks 18–19 (มะม่วง)
 *
 * Shape: smooth elongated teardrop with hook stem.
 * No pit distinguishes it from avocado; no strong waist distinguishes it from pear.
 * Design: baby-size-home-section.md §5 "BabySizeMangoIcon"
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabySizeMangoIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body: smooth elongated oval */}
      <Path
        d="M12 2 C8 2 5 6 5 12 C5 18 8 22 12 22 C16 22 19 18 19 12 C19 6 16 2 12 2 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Hook stem */}
      <Path
        d="M12 2 C11 1 12 0 13 1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
