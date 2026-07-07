/**
 * TabCoinsIcon — Expenses tab icon (ค่าใช้จ่าย).
 * Shape: 3 stacked coins (ellipses viewed slightly front-on).
 * Spec: minimal-redesign-clean-spec.md §3.1
 * Change: replaces TabWalletIcon per owner decision (coins convey "money" better).
 */
import React from 'react';
import Svg, { Ellipse, Line } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabCoinsIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Top coin face */}
      <Ellipse
        cx="12"
        cy="7"
        rx="8"
        ry="2.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Middle coin divider (shows 2nd coin in stack) */}
      <Ellipse
        cx="12"
        cy="12"
        rx="8"
        ry="2.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom coin face (3rd coin) */}
      <Ellipse
        cx="12"
        cy="17"
        rx="8"
        ry="2.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Left side of coin stack */}
      <Line
        x1="4"
        y1="7"
        x2="4"
        y2="19.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Right side of coin stack */}
      <Line
        x1="20"
        y1="7"
        x2="20"
        y2="19.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  );
}
