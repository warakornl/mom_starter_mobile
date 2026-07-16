/**
 * EditIcon — shared edit/pencil glyph for editable date/time display fields.
 * Shape: pencil body at 45-degree angle with a pointed tip.
 * Replaces the "✎" text glyph in CaptureScreen date/time buttons.
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function EditIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Pencil shaft */}
      <Path
        d="M4 20 L4.6 16.7 L15.5 5.8 C16.1 5.2 17.1 5.2 17.7 5.8 L18.2 6.3 C18.8 6.9 18.8 7.9 18.2 8.5 L7.3 19.4 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Tip line separating the point from the shaft */}
      <Path
        d="M14 7.3 L16.7 10"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
