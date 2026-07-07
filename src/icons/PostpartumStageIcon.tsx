/**
 * PostpartumStageIcon — Postpartum stage icon (replaces 🍃 emoji).
 * Shape: rocking cradle — base arc, leg tips, and oval cradle body.
 * Uses Ellipse (required import for this icon only per spec §3).
 * Rendered at size={28} in PostpartumBanner without container.
 * Color when rendered postpartum: sage/700 #4C6B57 (passed as color prop).
 * Spec: minimal-redesign-clean-spec.md §3.2
 */
import React from 'react';
import Svg, { Path, Ellipse, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function PostpartumStageIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Oval cradle body */}
      <Ellipse
        cx="12"
        cy="10"
        rx="6"
        ry="5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Base arc — rocking cradle base */}
      <Path
        d="M4 18 Q12 12 20 18"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Left leg tip */}
      <Line
        x1="4"
        y1="18"
        x2="4"
        y2="21"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Right leg tip */}
      <Line
        x1="20"
        y1="18"
        x2="20"
        y2="21"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
