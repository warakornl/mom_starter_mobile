/**
 * StageT3Icon — T3 Tree stage icon (replaces 🌳 emoji).
 * Shape: round-canopy tree with crown circle and trunk.
 * Rendered at size={28} directly in StageBanner without container.
 * Spec: minimal-redesign-clean-spec.md §3.2
 */
import React from 'react';
import Svg, { Circle, Rect } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function StageT3Icon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Round crown */}
      <Circle
        cx="12"
        cy="9"
        r="7"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Trunk */}
      <Rect
        x="10"
        y="16"
        width="4"
        height="6"
        rx="1"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
