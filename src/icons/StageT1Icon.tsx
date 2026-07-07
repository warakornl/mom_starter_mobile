/**
 * StageT1Icon — T1 Seedling stage icon (replaces 🌱 emoji).
 * Shape: sprout with center stem and two small teardrop leaves.
 * Rendered at size={28} directly in StageBanner without container.
 * Spec: minimal-redesign-clean-spec.md §3.2
 */
import React from 'react';
import Svg, { Line, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function StageT1Icon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Center stem */}
      <Line
        x1="12"
        y1="22"
        x2="12"
        y2="10"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Left leaf: small teardrop */}
      <Path
        d="M12 16 C12 16 6 14 6 8 C6 8 10 8 12 12"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Right leaf: mirrored */}
      <Path
        d="M12 16 C12 16 18 14 18 8 C18 8 14 8 12 12"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
