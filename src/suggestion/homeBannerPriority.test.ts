/**
 * homeBannerPriority.test.ts — Compliance-critical coexistence test (TDD).
 *
 * The consent nudge and suggestion banner on HomeScreen are mutually exclusive:
 *   - consent nudge shown when generalHealthGranted = false (compliance-first)
 *   - suggestion banner shown only when generalHealthGranted = true AND a top
 *     suggestion is offerable
 * This contract is safety-critical (PDPA §§ 19–20): showing health suggestions
 * before consent is granted would be non-compliant.
 *
 * The decision is extracted into `resolveHomeBanner` (pure function, no I/O)
 * so it can be unit-tested without rendering HomeScreen.
 */

import { resolveHomeBanner } from './homeBannerPriority';
import type { OfferableSuggestion } from './types';

const TOP_SUGGESTION: OfferableSuggestion = {
  key: 'kick_count_start',
  captureTarget: 'kick_count',
  evidenceStrength: 'HIGH',
  source: 'กรมอนามัย',
};

// ─── consent nudge takes priority ────────────────────────────────────────────

describe('resolveHomeBanner — consent nudge takes priority', () => {
  it('shows consent_nudge when generalHealthGranted is false', () => {
    const result = resolveHomeBanner(false, null);
    expect(result.show).toBe('consent_nudge');
  });

  it('shows consent_nudge (not suggestion_banner) when consent ungranted even if a top suggestion exists', () => {
    const result = resolveHomeBanner(false, TOP_SUGGESTION);
    expect(result.show).toBe('consent_nudge');
  });
});

// ─── suggestion banner shown when consent is granted ─────────────────────────

describe('resolveHomeBanner — suggestion banner when consent granted', () => {
  it('shows suggestion_banner when generalHealthGranted and topSuggestion exists', () => {
    const result = resolveHomeBanner(true, TOP_SUGGESTION);
    expect(result.show).toBe('suggestion_banner');
    if (result.show === 'suggestion_banner') {
      expect(result.topSuggestion).toEqual(TOP_SUGGESTION);
    }
  });

  it('shows none when consent granted but no offerable suggestion', () => {
    const result = resolveHomeBanner(true, null);
    expect(result.show).toBe('none');
  });
});

// ─── mutual exclusion ─────────────────────────────────────────────────────────

describe('resolveHomeBanner — mutual exclusion', () => {
  it('never shows suggestion_banner when consent is ungranted', () => {
    const result = resolveHomeBanner(false, TOP_SUGGESTION);
    expect(result.show).not.toBe('suggestion_banner');
  });

  it('never shows consent_nudge when consent is granted', () => {
    const result = resolveHomeBanner(true, TOP_SUGGESTION);
    expect(result.show).not.toBe('consent_nudge');
  });

  it('consent_nudge and suggestion_banner are never both shown at once', () => {
    // Exhaustive over the boolean × offerable space
    const cases: [boolean, OfferableSuggestion | null][] = [
      [false, null],
      [false, TOP_SUGGESTION],
      [true, null],
      [true, TOP_SUGGESTION],
    ];
    for (const [granted, top] of cases) {
      const result = resolveHomeBanner(granted, top);
      const isConsentNudge = result.show === 'consent_nudge';
      const isSuggestionBanner = result.show === 'suggestion_banner';
      expect(isConsentNudge && isSuggestionBanner).toBe(false);
    }
  });
});
