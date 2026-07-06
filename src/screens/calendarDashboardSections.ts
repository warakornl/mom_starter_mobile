/**
 * calendarDashboardSections.ts — pure function for Calendar tab dashboard layout.
 *
 * Resolves which dashboard sections are visible based on lifecycle state.
 * Extracted from CalendarTabScreen so that ALL conditional-visibility logic
 * can be unit-tested without rendering React components.
 *
 * Design spec: bottom-tab-navigation-design.md §3.3 (canonical section order).
 *
 * Section order per §3.3:
 *   Pregnant wk<32:
 *     stage banner → consent nudge* → suggestion banner† → progress bar → days-to-due
 *   Pregnant wk≥32:
 *     stage banner → consent nudge* → kick-count card → suggestion banner† → progress bar → days-to-due
 *   Postpartum:
 *     postpartum banner → PostpartumDayCard → consent nudge* → suggestion banner† → history link
 *
 *   * consent nudge = shown when !generalHealthGranted (compliance-critical)
 *   † suggestion banner = shown when generalHealthGranted && hasOfferableSuggestion
 *   These two are mutually exclusive (verified across §3.3, §4.2, §7.2).
 *
 * Kick-count gate (spec §4.2, verified from HomeScreen.tsx L1085):
 *   - pregnant + gestationalWeek >= 32: card shown (no consent gate)
 *   - all other cases: not shown
 *
 * Postpartum history link (spec §4.3):
 *   - always visible postpartum, no gate
 */

import type { Lifecycle } from '../pregnancy/types';
import { shouldShowModule } from '../kickCount/kickCountLogic';

// ─── Input / output types ─────────────────────────────────────────────────────

export interface DashboardSectionsInput {
  lifecycle: Lifecycle;
  gestationalWeek: number;
  generalHealthGranted: boolean;
  hasOfferableSuggestion: boolean;
}

export interface DashboardSections {
  /** Pregnancy trimester banner (T1/T2/T3 glyph + week). Pregnant only. */
  showStageBanner: boolean;
  /**
   * Active kick-count card "ได้เวลานับลูกดิ้นแล้ว ›".
   * Pregnant + gestationalWeek >= 32 ONLY. No consent gate.
   */
  showKickCountCard: boolean;
  /** Postpartum banner (sage tones, baby age + birthdate). Postpartum only. */
  showPostpartumBanner: boolean;
  /**
   * Large day-count card "X วันหลังคลอด". Postpartum only.
   * Positioned BEFORE consent/suggestion zone (spec §3.3 hero pair).
   */
  showPostpartumDayCard: boolean;
  /**
   * Consent limited-mode nudge. Shown when !generalHealthGranted.
   * COMPLIANCE-CRITICAL: mutually exclusive with showSuggestionBanner.
   */
  showConsentNudge: boolean;
  /**
   * Suggestion banner. Shown when generalHealthGranted && hasOfferableSuggestion.
   * COMPLIANCE-CRITICAL: mutually exclusive with showConsentNudge.
   */
  showSuggestionBanner: boolean;
  /** Pregnancy progress bar. Pregnant only. */
  showProgressBar: boolean;
  /** Days-to-due large number card. Pregnant only. */
  showDaysToDue: boolean;
  /**
   * Quiet postpartum history link "ดูประวัติการนับลูกดิ้น ›".
   * Always visible postpartum. No gate. Direct to KickCountHistoryScreen.
   */
  showPostpartumHistoryLink: boolean;
}

// ─── Pure resolver ────────────────────────────────────────────────────────────

/**
 * Resolve which Calendar tab dashboard sections should be visible.
 *
 * This is the single source-of-truth for all conditional visibility rules
 * in the Calendar tab dashboard area (spec §3.3).
 */
export function resolveCalendarDashboardSections(
  input: DashboardSectionsInput,
): DashboardSections {
  const { lifecycle, gestationalWeek, generalHealthGranted, hasOfferableSuggestion } = input;

  const isPregnant = lifecycle === 'pregnant';
  const isPostpartum = lifecycle === 'postpartum';

  // Kick-count gate: pregnant + wk>=32 (reuses shouldShowModule from kickCountLogic,
  // which was the gate in HomeScreen.tsx L1085 — preserving exact same gate logic).
  const showKickCountCard = isPregnant && shouldShowModule(gestationalWeek, 'pregnant');

  // Consent/suggestion mutual exclusion (compliance-critical — PDPA §§ 19-20):
  //   consent nudge: shown when !generalHealthGranted
  //   suggestion banner: shown only when generalHealthGranted && offerable
  const showConsentNudge = !generalHealthGranted;
  const showSuggestionBanner = generalHealthGranted && hasOfferableSuggestion;

  return {
    // Pregnant-only sections
    showStageBanner: isPregnant,
    showProgressBar: isPregnant,
    showDaysToDue: isPregnant,

    // Kick-count card (pregnant wk>=32, no consent gate)
    showKickCountCard,

    // Postpartum-only sections
    showPostpartumBanner: isPostpartum,
    showPostpartumDayCard: isPostpartum,
    showPostpartumHistoryLink: isPostpartum,

    // Shared across both lifecycles (consent/suggestion zone)
    showConsentNudge,
    showSuggestionBanner,
  };
}
