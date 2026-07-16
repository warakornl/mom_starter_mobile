/**
 * ReceiptIcon — expenses empty-state affordance.
 * Shape: receipt strip with a torn (zigzag) bottom edge + content lines.
 * Replaces the 🧾 emoji in ExpensesScreen empty state.
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Path, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function ReceiptIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Receipt body with torn bottom edge */}
      <Path
        d="M5 3 H19 V19.5 L17 21 L15 19.5 L13 21 L11 19.5 L9 21 L7 19.5 L5 21 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Content lines */}
      <Line x1="8" y1="7.5" x2="16" y2="7.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="8" y1="11" x2="16" y2="11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="8" y1="14.5" x2="13" y2="14.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}
