/**
 * TabChecklistIcon — Supplies tab icon (ของใช้).
 * Shape: clipboard with clip bar and content lines.
 * Spec: minimal-redesign-clean-spec.md §3.1
 */
import React from 'react';
import Svg, { Rect, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabChecklistIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Outer clipboard body */}
      <Rect
        x="3"
        y="5"
        width="18"
        height="17"
        rx="2"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Clip bar at top-center */}
      <Rect
        x="9"
        y="3"
        width="6"
        height="4"
        rx="1.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Content line 1 — full width */}
      <Line
        x1="7"
        y1="10"
        x2="17"
        y2="10"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Content line 2 — medium */}
      <Line
        x1="7"
        y1="14"
        x2="14"
        y2="14"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Content line 3 — shortest */}
      <Line
        x1="7"
        y1="18"
        x2="12"
        y2="18"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
