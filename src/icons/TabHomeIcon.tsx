/**
 * TabHomeIcon — Home tab icon (หน้าหลัก).
 * Shape: classic house with roof chevron, body, and door.
 * Spec: minimal-redesign-clean-spec.md §3.1
 */
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabHomeIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Roof chevron */}
      <Path
        d="M2 12 L12 3 L22 12"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* House body */}
      <Rect
        x="4"
        y="12"
        width="16"
        height="9"
        rx="1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Front door */}
      <Rect
        x="9"
        y="14"
        width="6"
        height="7"
        rx="1"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
