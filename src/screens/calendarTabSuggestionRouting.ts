/**
 * calendarTabSuggestionRouting — pure helper to resolve the navigation action
 * for a suggestion banner "Start" CTA in CalendarTabScreen.
 *
 * Extracted from the inline `resolveSuggestionAction` that previously returned
 * `() => {}` (dead no-op) for all targets except `kick_count`.
 *
 * Routing table (mirrors old HomeScreen.tsx L806-817 adapted to tab world):
 *   kick_count  → onKickCount  (KickCountHome — wk≥32 gate already checked by catalog)
 *   supplies    → onSupplies   (Supplies tab — purchase/checklist destination)
 *   appointment → onCalendar   (Calendar tab — add appointment from capture flow)
 *   medication  → onCalendar   (Calendar tab — medication reminder / capture)
 *   self_log    → onCalendar   (Calendar tab — quick capture)
 *   default     → onCalendar   (safe fallback — Calendar is the primary entry)
 *
 * All callbacks are optional so the function is safe to call when a destination
 * screen is not yet wired (no crash, just a no-op).
 *
 * Design ref: bottom-tab-navigation-design.md §F1, calendar-home-screens §5.
 */

import type { CaptureTarget } from '../suggestion/types';

export interface SuggestionRoutingCallbacks {
  onKickCount?: () => void;
  onSupplies?: () => void;
  onCalendar?: () => void;
}

/**
 * Returns a zero-argument action thunk for the suggestion banner "Start" button.
 * The returned function is lazy — it captures the callbacks by reference and
 * calls the appropriate one when invoked.
 *
 * Every supported CaptureTarget routes to a live callback; none returns a dead
 * `() => {}` that silently swallows the tap.
 */
export function resolveSuggestionAction(
  captureTarget: CaptureTarget,
  callbacks: SuggestionRoutingCallbacks,
): () => void {
  switch (captureTarget) {
    case 'kick_count':
      return () => callbacks.onKickCount?.();
    case 'supplies':
      return () => callbacks.onSupplies?.();
    case 'appointment':
    case 'medication':
    case 'self_log':
    default:
      return () => callbacks.onCalendar?.();
  }
}
