/**
 * CloseIcon — shared close/remove/clear/dismiss/unlink glyph.
 * Shape: simple X made of two crossing diagonal strokes.
 * Replaces the standalone "✕" text glyph across modal-close, dismiss,
 * unlink, and clear-field affordances (BabySizeSection, SuggestionBanner,
 * AutoDecrementSettingsScreen, ReminderFormScreen, MedicationPlanFormSheet).
 * Convention: minimal-redesign-clean-spec.md §3.1 (stroke line-icon system).
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  color?: string;
  size?: number;
}

export function CloseIcon({ color = 'currentColor', size = 24 }: Props): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 5 L19 19 M19 5 L5 19"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
