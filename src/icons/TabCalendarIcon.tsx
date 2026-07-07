/**
 * TabCalendarIcon — Calendar tab icon (ปฏิทิน).
 * Shape: month-view calendar with tab pegs, divider, and date grid.
 * Spec: minimal-redesign-clean-spec.md §3.1
 */
import React from 'react';
import Svg, { Rect, Line, Circle } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabCalendarIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Calendar body */}
      <Rect
        x="2"
        y="4"
        width="20"
        height="17"
        rx="2"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Left tab peg */}
      <Rect
        x="7"
        y="2"
        width="3"
        height="4"
        rx="1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right tab peg */}
      <Rect
        x="14"
        y="2"
        width="3"
        height="4"
        rx="1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Horizontal divider */}
      <Line
        x1="2"
        y1="10"
        x2="22"
        y2="10"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Date grid: 3 columns × 2 rows of small circles */}
      {/* Row 1 */}
      <Circle cx="7" cy="14" r="1" fill={color} />
      <Circle cx="12" cy="14" r="1" fill={color} />
      <Circle cx="17" cy="14" r="1" fill={color} />
      {/* Row 2 */}
      <Circle cx="7" cy="18" r="1" fill={color} />
      <Circle cx="12" cy="18" r="1" fill={color} />
      <Circle cx="17" cy="18" r="1" fill={color} />
    </Svg>
  );
}
