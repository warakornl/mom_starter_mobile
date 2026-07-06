/**
 * Suggestion engine — pure deterministic logic.
 *
 * `getOfferable` computes the ordered list of suggestions a user should see
 * given their current context and local state.  No I/O, no side effects —
 * fully unit-testable.
 *
 * Algorithm:
 *   1. lifecycle = 'ended' → always empty (suggestion-flow-ui.md §0, §2.7)
 *   2. Filter catalog by lifecycle
 *   3. For lifecycle='pregnant': filter by stage and gestational-week gates
 *   4. Filter by user state:
 *        - 'dismissed' → excluded permanently (until re-enabled)
 *        - 'started'   → excluded (mother already acted)
 *        - 'snoozed'   → excluded if resurfacesAt > now; included if ≤ now
 *        - 'offered'   → always included
 *        - (no record) → treated as 'offered'
 *   5. Sort by evidence strength: HIGH < STRONG < MODERATE
 *   6. Map to OfferableSuggestion (drops lifecycle/stage gate fields)
 *
 * Security: processes no health values, no tokens, no PII. Only civil dates
 * (via `now`) and gestational week numbers.
 */

import { SUGGESTION_CATALOG } from './suggestionCatalog';
import type {
  OfferableSuggestion,
  SuggestionContext,
  UserSuggestionState,
} from './types';

// Evidence priority (lower = higher priority)
const EVIDENCE_RANK: Record<string, number> = {
  HIGH: 0,
  STRONG: 1,
  MODERATE: 2,
};

/**
 * Returns the ordered list of suggestions that should be shown to the user.
 *
 * @param ctx - User's current context (lifecycle, stage, gestational week, now)
 * @param userStates - Partial record of the user's per-suggestion states.
 *   Keys not present are treated as 'offered'.
 */
export function getOfferable(
  ctx: SuggestionContext,
  userStates: Partial<Record<string, UserSuggestionState>>,
): OfferableSuggestion[] {
  // Rule: lifecycle = 'ended' → always empty (suggestion-flow-ui.md §0)
  if (ctx.lifecycle === 'ended') return [];

  return SUGGESTION_CATALOG
    .filter((entry) => {
      // ── Lifecycle gate ──────────────────────────────────────────────────
      if (!entry.applicableLifecycles.includes(ctx.lifecycle)) return false;

      // ── Stage gate (pregnant only) ──────────────────────────────────────
      if (
        ctx.lifecycle === 'pregnant' &&
        entry.applicableStages.length > 0
      ) {
        if (!ctx.stage || !entry.applicableStages.includes(ctx.stage)) {
          return false;
        }
      }

      // ── Gestational-week gate ───────────────────────────────────────────
      if (entry.startWeek !== undefined && ctx.gestationalWeek < entry.startWeek) {
        return false;
      }
      if (entry.endWeek !== undefined && ctx.gestationalWeek >= entry.endWeek) {
        return false;
      }

      // ── User state gate ─────────────────────────────────────────────────
      const state = userStates[entry.key];
      if (!state) return true; // no record → treat as 'offered'

      if (state.status === 'dismissed') return false;
      if (state.status === 'started') {
        // ANC cadence re-arm (§1.5): a started row with resurfacesAt behaves
        // exactly like snoozed — suppressed while resurfacesAt > now,
        // re-evaluable once now ≥ resurfacesAt.
        // A started row WITHOUT resurfacesAt (non-cadence keys) is a permanent
        // exclude — preserves existing behavior for all other keys.
        if (!state.resurfacesAt) return false;
        if (new Date(state.resurfacesAt) > ctx.now) return false;
      }
      if (state.status === 'snoozed') {
        // Resurface when resurfacesAt ≤ now (or when resurfacesAt is absent)
        if (state.resurfacesAt && new Date(state.resurfacesAt) > ctx.now) {
          return false;
        }
      }

      return true;
    })
    .sort(
      (a, b) =>
        (EVIDENCE_RANK[a.evidenceStrength] ?? 2) -
        (EVIDENCE_RANK[b.evidenceStrength] ?? 2),
    )
    .map((entry) => ({
      key: entry.key,
      captureTarget: entry.captureTarget,
      evidenceStrength: entry.evidenceStrength,
      source: entry.source,
    }));
}
