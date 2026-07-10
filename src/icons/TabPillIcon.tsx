/**
 * TabPillIcon — Medication tab icon (ยา).
 * Shape: capsule pill at 45-degree rotation.
 * Uses SVG string transform on <G> per spec §3.1 note.
 * Spec: minimal-redesign-clean-spec.md §3.1
 */
import React from 'react';
import Svg, { G, Rect, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabPillIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Group rotated 45° about icon center (12,12) using SVG string transform */}
      <G transform="rotate(-45 12 12)">
        {/* Capsule body */}
        <Rect
          x="6"
          y="2"
          width="12"
          height="20"
          rx="6"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dividing line at midpoint */}
        <Line
          x1="6"
          y1="12"
          x2="18"
          y2="12"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
}
