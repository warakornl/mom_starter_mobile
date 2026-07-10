/**
 * TabPersonIcon — Profile tab icon (โปรไฟล์).
 * Shape: person outline — head circle + shoulders arc.
 * Spec: minimal-redesign-clean-spec.md §3.1
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabPersonIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Head */}
      <Circle
        cx="12"
        cy="7"
        r="4"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Shoulders arc */}
      <Path
        d="M4 22 C4 16 8 13 12 13 C16 13 20 16 20 22"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
