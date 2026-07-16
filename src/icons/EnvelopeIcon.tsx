/**
 * EnvelopeIcon — email/verification affordance.
 * Shape: envelope outline with a chevron flap fold.
 * Replaces the ✉️ emoji placeholder in VerifyEmailScreen (decorative).
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Rect, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function EnvelopeIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Envelope body */}
      <Rect
        x="2"
        y="5"
        width="20"
        height="14"
        rx="2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Flap fold chevron */}
      <Path
        d="M3 6.5 L12 13 L21 6.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
