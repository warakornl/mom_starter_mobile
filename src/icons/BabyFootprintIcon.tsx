/**
 * BabyFootprintIcon — postpartum variant only.
 *
 * Shape: two baby footprints overlapping slightly.
 * Left/larger foot: heel ellipse + five toes.
 * Right/smaller foot: heel ellipse + three visible toes.
 * Rendered at size={28}, color="#4C6B57" (sage/700) in BabySizeSection.
 * Design: baby-size-home-section.md §5 "BabyFootprintIcon"
 */
import React from 'react';
import Svg, { Circle, Ellipse } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function BabyFootprintIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Left/larger foot — Heel */}
      <Ellipse
        cx="9.5"
        cy="17"
        rx="4"
        ry="5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Left foot — five toes */}
      <Circle cx="7"    cy="11.5" r="1"   stroke={color} strokeWidth="1.75" />
      <Circle cx="9.5"  cy="10.5" r="1.2" stroke={color} strokeWidth="1.75" />
      <Circle cx="12"   cy="11"   r="1"   stroke={color} strokeWidth="1.75" />
      <Circle cx="13.5" cy="12"   r="0.9" stroke={color} strokeWidth="1.75" />
      <Circle cx="14.5" cy="13.5" r="0.8" stroke={color} strokeWidth="1.75" />
      {/* Right/smaller foot — Heel */}
      <Ellipse
        cx="14"
        cy="19"
        rx="3.5"
        ry="4.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right foot — three visible toes */}
      <Circle cx="12"   cy="15"   r="0.8" stroke={color} strokeWidth="1.75" />
      <Circle cx="14.5" cy="14.5" r="0.9" stroke={color} strokeWidth="1.75" />
      <Circle cx="16.5" cy="15.5" r="0.8" stroke={color} strokeWidth="1.75" />
    </Svg>
  );
}
