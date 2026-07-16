/**
 * BookIcon — "saved to record" affordance (not an achievement stamp).
 * Shape: open book, two pages with a center spine.
 * Replaces the 📖 emoji in KickCountDetailScreen / KickCountSummaryScreen.
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BookIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Left page */}
      <Path
        d="M12 6 C10 4.5 6.5 4 3 4.5 V18.5 C6.5 18 10 18.5 12 20"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Right page */}
      <Path
        d="M12 6 C14 4.5 17.5 4 21 4.5 V18.5 C17.5 18 14 18.5 12 20"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Center spine */}
      <Path
        d="M12 6 V20"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
