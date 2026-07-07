/**
 * StageT2Icon — T2 Leaf stage icon (replaces 🌿 emoji).
 * Shape: full single leaf with central vein and side veins.
 * Rendered at size={28} directly in StageBanner without container.
 * Spec: minimal-redesign-clean-spec.md §3.2
 */
import React from 'react';
import Svg, { Path, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function StageT2Icon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Leaf outline: tall pointed oval */}
      <Path
        d="M12 22 C12 22 4 18 4 10 C4 4 8 2 12 2 C16 2 20 4 20 10 C20 18 12 22 12 22 Z"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Central vein */}
      <Line
        x1="12"
        y1="22"
        x2="12"
        y2="4"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Side veins — pair at y=8 */}
      <Line x1="12" y1="8" x2="8" y2="6" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
      <Line x1="12" y1="8" x2="16" y2="6" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
      {/* Side veins — pair at y=12 */}
      <Line x1="12" y1="12" x2="7" y2="11" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
      <Line x1="12" y1="12" x2="17" y2="11" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
      {/* Side veins — pair at y=16 */}
      <Line x1="12" y1="16" x2="8" y2="16" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
      <Line x1="12" y1="16" x2="16" y2="16" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    </Svg>
  );
}
