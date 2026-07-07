/**
 * tokens.ts — Design token delta for Direction C "เรียบ / Clean" redesign.
 *
 * Contains ONLY the values that change from what is currently inline.
 * This is NOT a full design-system refactor — unchanged colors (ink, inkSoft,
 * inkFaint, bg, surface, rose, etc.) remain as local constants in each screen.
 *
 * Spec: docs/design/minimal-redesign-clean-spec.md §1
 *
 * Import pattern: import { T } from '../theme/tokens'
 * (adjust relative depth per file location)
 *
 * Phase 1 consumers: HomeTabScreen.tsx, ProfileHubScreen.tsx
 * Phase 2: other screens import only T.hairline and T.cardRadius
 */

export const T = {
  /**
   * hairline — card/row border color.
   * CHANGED from #EBE1D9. Fractionally warmer/darker to compensate for the
   * removal of all box-shadow elevation. Provides visible card separation at
   * zero shadow. Phase 1 mandatory import for kickCountCard + deliveryChip.
   */
  hairline: '#E3D8CE',

  /**
   * cardRadius — all content cards and menu rows.
   * CHANGED from 16–20. Removes the AI-tell over-rounded look.
   */
  cardRadius: 8,

  /**
   * pillRadius — retained for the ONE allowed pill use per screen.
   * See spec §1.2: lifecycle badge, tab disc, CTA buttons.
   * Documented here for reference; NOT imported by screen files (value unchanged).
   */
  pillRadius: 999,

  /**
   * heroFontSize — daysNumber and ppCardStyles.number.
   * CHANGED from 56. Left-aligned at 28pt instead of centered metric widget.
   */
  heroFontSize: 28,

  /**
   * heroFontFamily — daysNumber and ppCardStyles.number.
   * CHANGED from IBMPlexMono-Medium. Mono is retained for timestamps/dates only.
   */
  heroFontFamily: 'IBMPlexSans-SemiBold',

  /**
   * sectionLabelFontSize — all sectionLabel across flagship screens.
   * CHANGED from 13–15. Unified at 11pt uppercase SemiBold.
   */
  sectionLabelFontSize: 11,

  /**
   * sectionLabelFontFamily — SemiBold at 11pt for editorial weight.
   */
  sectionLabelFontFamily: 'IBMPlexSans-SemiBold',

  /**
   * sectionLabelLetterSpacing — positive tracking for uppercase legibility.
   * CHANGED from 0.
   */
  sectionLabelLetterSpacing: 0.8,

  /**
   * sectionLabelColor — inkSoft, ~7.6:1 on bg (WCAG AAA).
   * HomeTabScreen already uses #5F4A52 — hub/settings unified UP to this value.
   */
  sectionLabelColor: '#5F4A52',
} as const;
