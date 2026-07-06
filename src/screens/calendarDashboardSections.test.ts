/**
 * calendarDashboardSections.test.ts — TDD tests for dashboard section resolver.
 *
 * Tests the pure function `resolveCalendarDashboardSections` that encapsulates
 * ALL conditional-visibility logic from design §3.3:
 *
 *   Pregnant wk<32  : stage banner + [consent nudge XOR suggestion] + progress + days-to-due
 *   Pregnant wk≥32  : stage banner + [consent nudge] + kick-count card + [suggestion] + progress + days-to-due
 *   Postpartum       : postpartum banner + PostpartumDayCard + [consent nudge XOR suggestion] + history link
 *
 * Key invariants:
 *   1. Kick-count card: pregnant wk≥32 ONLY (no consent gate)
 *   2. Postpartum history link: always visible postpartum (no gate)
 *   3. Consent-nudge / suggestion mutual exclusion (compliance-critical)
 *   4. PostpartumDayCard: before consent/suggestion zone in postpartum (spec §3.3 reorder)
 */

import { resolveCalendarDashboardSections } from './calendarDashboardSections';

// ─── Pregnant, wk < 32 ────────────────────────────────────────────────────────

describe('resolveCalendarDashboardSections — pregnant wk < 32', () => {
  const base = {
    lifecycle: 'pregnant' as const,
    gestationalWeek: 20,
    generalHealthGranted: false,
    hasOfferableSuggestion: false,
  };

  it('shows stage banner', () => {
    expect(resolveCalendarDashboardSections(base).showStageBanner).toBe(true);
  });

  it('does NOT show kick-count card (wk < 32)', () => {
    expect(resolveCalendarDashboardSections(base).showKickCountCard).toBe(false);
  });

  it('shows progress bar', () => {
    expect(resolveCalendarDashboardSections(base).showProgressBar).toBe(true);
  });

  it('shows days-to-due card', () => {
    expect(resolveCalendarDashboardSections(base).showDaysToDue).toBe(true);
  });

  it('shows consent nudge when !generalHealthGranted', () => {
    expect(resolveCalendarDashboardSections(base).showConsentNudge).toBe(true);
  });

  it('does NOT show suggestion banner when !generalHealthGranted', () => {
    const s = resolveCalendarDashboardSections({ ...base, hasOfferableSuggestion: true });
    expect(s.showSuggestionBanner).toBe(false);
  });

  it('does NOT show any postpartum elements', () => {
    const s = resolveCalendarDashboardSections(base);
    expect(s.showPostpartumBanner).toBe(false);
    expect(s.showPostpartumDayCard).toBe(false);
    expect(s.showPostpartumHistoryLink).toBe(false);
  });
});

// ─── Pregnant, wk >= 32 ───────────────────────────────────────────────────────

describe('resolveCalendarDashboardSections — pregnant wk >= 32', () => {
  it('shows kick-count card at exactly wk 32', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 32,
      generalHealthGranted: false,
      hasOfferableSuggestion: false,
    });
    expect(s.showKickCountCard).toBe(true);
  });

  it('shows kick-count card at wk 40', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 40,
      generalHealthGranted: false,
      hasOfferableSuggestion: false,
    });
    expect(s.showKickCountCard).toBe(true);
  });

  it('does NOT show kick-count card at wk 31', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 31,
      generalHealthGranted: false,
      hasOfferableSuggestion: false,
    });
    expect(s.showKickCountCard).toBe(false);
  });

  it('kick-count card is NOT consent-gated (shows even when !generalHealthGranted)', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 34,
      generalHealthGranted: false,
      hasOfferableSuggestion: false,
    });
    expect(s.showKickCountCard).toBe(true);
  });

  it('kick-count card shows even when consent is granted (not excluded by consent)', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 34,
      generalHealthGranted: true,
      hasOfferableSuggestion: false,
    });
    expect(s.showKickCountCard).toBe(true);
  });
});

// ─── Postpartum ───────────────────────────────────────────────────────────────

describe('resolveCalendarDashboardSections — postpartum', () => {
  const base = {
    lifecycle: 'postpartum' as const,
    gestationalWeek: 0,
    generalHealthGranted: false,
    hasOfferableSuggestion: false,
  };

  it('shows postpartum banner', () => {
    expect(resolveCalendarDashboardSections(base).showPostpartumBanner).toBe(true);
  });

  it('shows PostpartumDayCard', () => {
    expect(resolveCalendarDashboardSections(base).showPostpartumDayCard).toBe(true);
  });

  it('always shows kick-count history link (no gate)', () => {
    expect(resolveCalendarDashboardSections(base).showPostpartumHistoryLink).toBe(true);
  });

  it('kick-count history link visible even when consented + suggestions active', () => {
    const s = resolveCalendarDashboardSections({
      ...base,
      generalHealthGranted: true,
      hasOfferableSuggestion: true,
    });
    expect(s.showPostpartumHistoryLink).toBe(true);
  });

  it('does NOT show active kick-count card postpartum', () => {
    expect(resolveCalendarDashboardSections(base).showKickCountCard).toBe(false);
  });

  it('does NOT show stage banner postpartum', () => {
    expect(resolveCalendarDashboardSections(base).showStageBanner).toBe(false);
  });

  it('does NOT show progress bar postpartum', () => {
    expect(resolveCalendarDashboardSections(base).showProgressBar).toBe(false);
  });

  it('does NOT show days-to-due card postpartum', () => {
    expect(resolveCalendarDashboardSections(base).showDaysToDue).toBe(false);
  });

  it('shows consent nudge when !generalHealthGranted (postpartum)', () => {
    expect(resolveCalendarDashboardSections(base).showConsentNudge).toBe(true);
  });

  it('does NOT show suggestion banner when !generalHealthGranted (postpartum)', () => {
    const s = resolveCalendarDashboardSections({ ...base, hasOfferableSuggestion: true });
    expect(s.showSuggestionBanner).toBe(false);
  });

  it('shows suggestion banner when consented + offerable (postpartum)', () => {
    const s = resolveCalendarDashboardSections({
      ...base,
      generalHealthGranted: true,
      hasOfferableSuggestion: true,
    });
    expect(s.showSuggestionBanner).toBe(true);
    expect(s.showConsentNudge).toBe(false);
  });

  it('PostpartumDayCard is always shown regardless of consent (spec §3.3 hero pair)', () => {
    // PostpartumDayCard comes BEFORE the consent zone — it is not gated by consent
    const withConsent = resolveCalendarDashboardSections({ ...base, generalHealthGranted: true });
    const withoutConsent = resolveCalendarDashboardSections({ ...base, generalHealthGranted: false });
    expect(withConsent.showPostpartumDayCard).toBe(true);
    expect(withoutConsent.showPostpartumDayCard).toBe(true);
  });
});

// ─── Consent / suggestion mutual exclusion ────────────────────────────────────

describe('resolveCalendarDashboardSections — consent/suggestion mutual exclusion', () => {
  it('shows suggestion banner when consented + offerable (pregnant)', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 20,
      generalHealthGranted: true,
      hasOfferableSuggestion: true,
    });
    expect(s.showConsentNudge).toBe(false);
    expect(s.showSuggestionBanner).toBe(true);
  });

  it('shows neither when consented but no offerable suggestion', () => {
    const s = resolveCalendarDashboardSections({
      lifecycle: 'pregnant',
      gestationalWeek: 20,
      generalHealthGranted: true,
      hasOfferableSuggestion: false,
    });
    expect(s.showConsentNudge).toBe(false);
    expect(s.showSuggestionBanner).toBe(false);
  });

  it('consent_nudge and suggestion_banner never coexist — exhaustive check', () => {
    const cases = [
      { lifecycle: 'pregnant' as const, gestationalWeek: 20, generalHealthGranted: false, hasOfferableSuggestion: false },
      { lifecycle: 'pregnant' as const, gestationalWeek: 20, generalHealthGranted: false, hasOfferableSuggestion: true },
      { lifecycle: 'pregnant' as const, gestationalWeek: 20, generalHealthGranted: true, hasOfferableSuggestion: false },
      { lifecycle: 'pregnant' as const, gestationalWeek: 20, generalHealthGranted: true, hasOfferableSuggestion: true },
      { lifecycle: 'pregnant' as const, gestationalWeek: 34, generalHealthGranted: false, hasOfferableSuggestion: true },
      { lifecycle: 'pregnant' as const, gestationalWeek: 34, generalHealthGranted: true, hasOfferableSuggestion: true },
      { lifecycle: 'postpartum' as const, gestationalWeek: 0, generalHealthGranted: false, hasOfferableSuggestion: false },
      { lifecycle: 'postpartum' as const, gestationalWeek: 0, generalHealthGranted: false, hasOfferableSuggestion: true },
      { lifecycle: 'postpartum' as const, gestationalWeek: 0, generalHealthGranted: true, hasOfferableSuggestion: false },
      { lifecycle: 'postpartum' as const, gestationalWeek: 0, generalHealthGranted: true, hasOfferableSuggestion: true },
    ];
    for (const c of cases) {
      const s = resolveCalendarDashboardSections(c);
      expect(s.showConsentNudge && s.showSuggestionBanner).toBe(false);
    }
  });
});
