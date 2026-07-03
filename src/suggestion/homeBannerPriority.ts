/**
 * homeBannerPriority — pure decision function for HomeScreen banner priority.
 *
 * The consent nudge and suggestion banner are mutually exclusive on HomeScreen.
 * This function encodes the compliance-critical rule so it can be unit-tested
 * without rendering HomeScreen (which is heavyweight).
 *
 * Priority (HomeScreen §4 + PDPA compliance):
 *   1. Consent nudge — shown when general_health not granted (PDPA-first).
 *      Collecting health data without consent is non-compliant; the nudge
 *      routes the user to grant consent before health suggestions appear.
 *   2. Suggestion banner — shown only when consent is granted AND ≥1 suggestion
 *      is currently offerable.
 *   3. None — consent granted but no offerable suggestions (all handled).
 *
 * Security: processes no health values, no tokens, no PII.
 */

import type { OfferableSuggestion } from './types';

// ─── Decision type ────────────────────────────────────────────────────────────

export type BannerDecision =
  | { show: 'consent_nudge' }
  | { show: 'suggestion_banner'; topSuggestion: OfferableSuggestion }
  | { show: 'none' };

// ─── Pure resolver ────────────────────────────────────────────────────────────

/**
 * Resolves which banner (if any) should be shown on HomeScreen.
 *
 * @param generalHealthGranted - Whether the user has granted general_health consent.
 * @param topSuggestion - The first offerable suggestion (from suggestionEngine), or null.
 * @returns A discriminated union describing which banner to show.
 */
export function resolveHomeBanner(
  generalHealthGranted: boolean,
  topSuggestion: OfferableSuggestion | null,
): BannerDecision {
  // Priority 1: compliance nudge — no health suggestions until consent is granted
  if (!generalHealthGranted) {
    return { show: 'consent_nudge' };
  }
  // Priority 2: suggestion banner — only when at least one suggestion is offerable
  if (topSuggestion) {
    return { show: 'suggestion_banner', topSuggestion };
  }
  // Priority 3: nothing to show
  return { show: 'none' };
}
