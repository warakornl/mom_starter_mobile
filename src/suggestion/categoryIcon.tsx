/**
 * categoryIcon — shared CaptureTarget → stroke-icon component map.
 *
 * Single source of truth consumed by BOTH SuggestionFlowScreen and
 * SuggestionBanner so the two screens never drift (previously each file
 * held its own duplicated emoji map: 🌀/💊/📋/🎒/📓).
 *
 * Icon choices reuse the existing src/icons/ system where a shape already
 * fits the category, and add two new ones (BagIcon, NotebookIcon) for the
 * categories with no existing equivalent:
 *   kick_count  → BabyFootprintIcon (existing — postpartum/baby motif)
 *   medication  → TabPillIcon       (existing — capsule pill, already used
 *                                     for the Medication tab)
 *   appointment → TabCalendarIcon   (existing — already used for the
 *                                     Calendar tab; appointments live there)
 *   supplies    → BagIcon           (new — backpack, replaces 🎒)
 *   self_log    → NotebookIcon      (new — spiral notebook, replaces 📓)
 *
 * Fallback (unknown/未来 capture target) uses NotebookIcon — a neutral
 * "generic log" shape — matching the previous '🌱' fallback's role as a
 * safe default rather than signalling any specific category.
 */
import React from 'react';
import type { CaptureTarget } from './types';
import { BabyFootprintIcon } from '../icons/BabyFootprintIcon';
import { TabPillIcon } from '../icons/TabPillIcon';
import { TabCalendarIcon } from '../icons/TabCalendarIcon';
import { BagIcon } from '../icons/BagIcon';
import { NotebookIcon } from '../icons/NotebookIcon';

export interface CategoryIconProps {
  color?: string;
  size?: number;
}

type CategoryIconComponent = (props: CategoryIconProps) => React.JSX.Element;

const CATEGORY_ICONS: Record<CaptureTarget, CategoryIconComponent> = {
  kick_count: BabyFootprintIcon,
  medication: TabPillIcon,
  appointment: TabCalendarIcon,
  supplies: BagIcon,
  self_log: NotebookIcon,
};

/** Fallback icon for an unrecognized capture target (defensive default). */
const FALLBACK_ICON: CategoryIconComponent = NotebookIcon;

/**
 * Returns the stroke-icon component for a given CaptureTarget.
 * Call sites render `<Icon color={...} size={...} />`.
 */
export function getCategoryIcon(captureTarget: CaptureTarget | string): CategoryIconComponent {
  return CATEGORY_ICONS[captureTarget as CaptureTarget] ?? FALLBACK_ICON;
}
