/**
 * calendarTabSuggestionRouting.test.ts — TDD tests for suggestion CTA routing.
 *
 * Verifies that resolveSuggestionAction maps every CaptureTarget to a live
 * navigation callback so no "Start" button in the suggestion banner is a no-op.
 *
 * Design ref: bottom-tab-navigation-design.md §F1 / old HomeScreen.tsx L806-817.
 * Every case must call a real callback — dead `() => {}` is a regression.
 */

import { resolveSuggestionAction } from './calendarTabSuggestionRouting';
import type { CaptureTarget } from '../suggestion/types';

describe('resolveSuggestionAction — no dead buttons', () => {
  it('kick_count → calls onKickCount', () => {
    const onKickCount = jest.fn();
    const action = resolveSuggestionAction('kick_count', { onKickCount });
    action();
    expect(onKickCount).toHaveBeenCalledTimes(1);
  });

  it('supplies → calls onSupplies (was dead no-op before fix)', () => {
    const onSupplies = jest.fn();
    const action = resolveSuggestionAction('supplies', { onSupplies });
    action();
    expect(onSupplies).toHaveBeenCalledTimes(1);
  });

  it('appointment → calls onCalendar (calendar capture flow)', () => {
    const onCalendar = jest.fn();
    const action = resolveSuggestionAction('appointment', { onCalendar });
    action();
    expect(onCalendar).toHaveBeenCalledTimes(1);
  });

  it('medication → calls onCalendar (calendar capture flow)', () => {
    const onCalendar = jest.fn();
    const action = resolveSuggestionAction('medication', { onCalendar });
    action();
    expect(onCalendar).toHaveBeenCalledTimes(1);
  });

  it('self_log → calls onCalendar (calendar capture flow)', () => {
    const onCalendar = jest.fn();
    const action = resolveSuggestionAction('self_log', { onCalendar });
    action();
    expect(onCalendar).toHaveBeenCalledTimes(1);
  });

  it('unknown captureTarget (default) → calls onCalendar as fallback', () => {
    const onCalendar = jest.fn();
    // Cast to bypass union — tests forward-compat default branch
    const action = resolveSuggestionAction('unknown_future' as CaptureTarget, { onCalendar });
    action();
    expect(onCalendar).toHaveBeenCalledTimes(1);
  });

  it('all callbacks optional — no crash when callbacks are undefined', () => {
    // If the prop is not wired yet (e.g. during screen migration), no crash.
    expect(() => resolveSuggestionAction('supplies', {})()).not.toThrow();
    expect(() => resolveSuggestionAction('kick_count', {})()).not.toThrow();
    expect(() => resolveSuggestionAction('appointment', {})()).not.toThrow();
  });

  it('returns a function (lazy — not invoked immediately)', () => {
    const onKickCount = jest.fn();
    const action = resolveSuggestionAction('kick_count', { onKickCount });
    expect(typeof action).toBe('function');
    // Not yet called
    expect(onKickCount).not.toHaveBeenCalled();
  });
});
