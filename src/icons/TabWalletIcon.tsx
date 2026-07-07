/**
 * TabWalletIcon — Expenses tab icon (ค่าใช้จ่าย).
 * Shape: bi-fold wallet with coin pocket.
 * Spec: minimal-redesign-clean-spec.md §3.1
 */
import React from 'react';
import Svg, { Rect, Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function TabWalletIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Main wallet body */}
      <Rect
        x="1"
        y="8"
        width="21"
        height="13"
        rx="2.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Fold hint: arc from top-left corner suggesting folded bill/card */}
      <Path
        d="M1 8 C1 8 3 5 6 5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Coin pocket: small rounded rectangle on right interior */}
      <Rect
        x="13"
        y="11"
        width="7"
        height="7"
        rx="3.5"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
