/**
 * LockIcon — privacy/local-only affordance next to field privacy notes.
 * Shape: padlock body + shackle arc.
 * Replaces the 🔒 emoji in MedicationPlanFormSheet privacy lines.
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Rect, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function LockIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Shackle arc */}
      <Path
        d="M7 10 V7.5 C7 4.5 9.2 2.5 12 2.5 C14.8 2.5 17 4.5 17 7.5 V10"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Lock body */}
      <Rect
        x="4.5"
        y="10"
        width="15"
        height="11"
        rx="2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Keyhole */}
      <Path
        d="M12 14.5 V17.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
