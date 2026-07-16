/**
 * EyeIcon — "show password" affordance (password currently hidden).
 * Shape: almond eye outline + iris circle.
 * Replaces the 👁 emoji toggle glyph in Login/Register/ResetPassword.
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function EyeIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Almond eye outline */}
      <Path
        d="M2 12 C4.5 7 8 4.5 12 4.5 C16 4.5 19.5 7 22 12 C19.5 17 16 19.5 12 19.5 C8 19.5 4.5 17 2 12 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Iris */}
      <Circle
        cx="12"
        cy="12"
        r="3"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
