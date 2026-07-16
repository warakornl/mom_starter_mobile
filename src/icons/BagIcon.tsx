/**
 * BagIcon — supplies capture-target category icon (ของใช้ / 🎒 replacement).
 * Shape: backpack outline with top handle loop and front pocket.
 * Used by the shared suggestion category→icon map (categoryIcon.tsx).
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BagIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Top handle loop */}
      <Path
        d="M9 5 V3.5 C9 2.7 9.7 2 10.5 2 H13.5 C14.3 2 15 2.7 15 3.5 V5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Backpack body */}
      <Path
        d="M5 8 C5 6.3 6.3 5 8 5 H16 C17.7 5 19 6.3 19 8 V19 C19 20.1 18.1 21 17 21 H7 C5.9 21 5 20.1 5 19 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Front pocket */}
      <Rect
        x="8.5"
        y="12"
        width="7"
        height="6"
        rx="1.2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
