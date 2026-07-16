/**
 * NotebookIcon — self_log capture-target category icon (บันทึกส่วนตัว / 📓 replacement).
 * Shape: spiral-bound notebook — cover rectangle + spiral rings + content lines.
 * Used by the shared suggestion category→icon map (categoryIcon.tsx).
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Rect, Line, Circle } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function NotebookIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Cover */}
      <Rect
        x="5"
        y="3"
        width="15"
        height="18"
        rx="2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Spiral rings along the left edge */}
      <Circle cx="5" cy="7" r="1" stroke={color} strokeWidth="1.5" />
      <Circle cx="5" cy="12" r="1" stroke={color} strokeWidth="1.5" />
      <Circle cx="5" cy="17" r="1" stroke={color} strokeWidth="1.5" />
      {/* Content lines */}
      <Line x1="9" y1="9" x2="16" y2="9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="9" y1="13" x2="16" y2="13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="9" y1="17" x2="13" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}
