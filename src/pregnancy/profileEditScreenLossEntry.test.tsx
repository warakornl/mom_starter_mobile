/**
 * profileEditScreenLossEntry.test.tsx — TDD for the loss entry link (Screen A)
 * on Account ▸ การตั้งครรภ์ (ProfileEditScreen).
 *
 * pregnancy-loss-recording-ui.md §2 (Screen A entry).
 *
 * INV-ENTRY-2: the loss entry link renders ONLY when lifecycle === 'pregnant'
 * (raw snapshot — never a `?? 'pregnant'` fallback). null/postpartum/ended →
 * absent (not disabled — absent).
 *
 * mobile-reviewer BLOCKER-1: the Screen C reopen entry USED to live here too,
 * but this host's GET-outcome resolver (resolveEditGetOutcome,
 * profileEditLogic.ts) returns 'guard-not-editable' for EVERY
 * lifecycle !== 'pregnant' — so `profile.lifecycle === 'ended'` can NEVER be
 * true at this screen's show-form render, making a reopen link here
 * unreachable dead code. It has been removed from ProfileEditScreen and
 * moved to ProfileHubScreen (see profileHubReopenEntry.test.tsx for the
 * real reachability proof: raw snapshot → no lifecycle gate on the host →
 * real navigate() call).
 */

jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', StyleSheet: { create: (o: unknown) => o },
  ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));
jest.mock('./profileEditRuntimeWiring', () => ({ runEntryGet: jest.fn() }));
jest.mock('./profileEditBeforeRemoveHandler', () => ({ buildBeforeRemoveHandler: jest.fn(() => jest.fn()) }));
jest.mock('./ProfileSetupScreen', () => ({ ProfileSetupScreen: () => null }));

import React from 'react';
import { T } from '../theme/tokens';
import type { PregnancyProfile, Lifecycle } from './types';

const mockTokenStorage = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
const mockNavigation = { addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), goBack: jest.fn() };

function makeProfile(lifecycle: Lifecycle): PregnancyProfile {
  return {
    id: 'p1',
    version: 3,
    edd: '2026-12-25',
    eddBasis: 'due_date',
    lifecycle,
    gestationalWeek: 20,
    gestationalDay: 0,
    daysRemaining: 100,
    progress: 0.5,
    currentStage: 'T2',
    deliveryWindowActive: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

/**
 * Renders ProfileEditScreen with `outcome` pre-seeded to 'show-form' for the
 * given profile — mocks React's useState so the FIRST call (outcome) returns
 * the desired seeded value; every other useState/useCallback/useRef call
 * falls back to the generic "return the initializer" pattern used elsewhere
 * in this test suite (profileEditScreen.motherRoom.test.tsx).
 *
 * Note: in production, `resolveEditGetOutcome` never actually produces
 * 'show-form' for a non-pregnant profile (profileEditLogic.ts guards it to
 * 'guard-not-editable') — this seeding is a unit-level probe of the render
 * function's OWN conditional (`profile.lifecycle === 'pregnant'`), not a
 * claim that ProfileEditScreen can reach show-form with an ended profile.
 */
function renderShowForm(profile: PregnancyProfile): React.ReactElement {
  jest.resetModules();
  jest.doMock('react', () => {
    const actual = jest.requireActual<typeof import('react')>('react');
    let callIndex = 0;
    return {
      ...actual,
      useState: jest.fn((init: unknown) => {
        callIndex += 1;
        if (callIndex === 1) {
          return [{ type: 'show-form', profile }, jest.fn()];
        }
        return [init, jest.fn()];
      }),
      useEffect: jest.fn(),
      useCallback: jest.fn((fn: unknown) => fn),
      useRef: jest.fn((init: unknown) => ({ current: init })),
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProfileEditScreen } = require('./ProfileEditScreen') as typeof import('./ProfileEditScreen');
  return ProfileEditScreen({
    tokenStorage: mockTokenStorage,
    apiBaseUrl: 'https://api.example.com',
    navigation: mockNavigation as never,
    onEditComplete: jest.fn(),
    onSessionExpired: jest.fn(),
  }) as React.ReactElement;
}

function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || n === false) return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

function byTestId(tree: unknown, id: string): React.ReactElement | undefined {
  return findAll(tree, (el) => (el.props as { testID?: string }).testID === id)[0];
}

describe('ProfileEditScreen — loss entry link (Screen A only)', () => {
  afterEach(() => {
    jest.dontMock('react');
    jest.resetModules();
  });

  it('lifecycle=pregnant: loss entry link IS shown (INV-ENTRY-2)', () => {
    const tree = renderShowForm(makeProfile('pregnant'));
    expect(byTestId(tree, 'loss-entry-link')).toBeDefined();
  });

  it('reopen-entry-link is NEVER rendered by this screen (removed — was dead/unreachable, BLOCKER-1)', () => {
    const tree = renderShowForm(makeProfile('pregnant'));
    expect(byTestId(tree, 'reopen-entry-link')).toBeUndefined();
  });

  it('loss entry link is accessibilityRole="link" with the entry i18n key label', () => {
    const tree = renderShowForm(makeProfile('pregnant'));
    const link = byTestId(tree, 'loss-entry-link');
    expect((link!.props as { accessibilityRole?: string }).accessibilityRole).toBe('link');
    expect((link!.props as { accessibilityLabel?: string }).accessibilityLabel).toBe('loss.entry.link');
  });

  it('tapping the loss entry link calls navigation.navigate("LossConfirm", { profileVersion })', () => {
    jest.resetModules();
    jest.doMock('react', () => {
      const actual = jest.requireActual<typeof import('react')>('react');
      let callIndex = 0;
      return {
        ...actual,
        useState: jest.fn((init: unknown) => {
          callIndex += 1;
          if (callIndex === 1) {
            return [{ type: 'show-form', profile: makeProfile('pregnant') }, jest.fn()];
          }
          return [init, jest.fn()];
        }),
        useEffect: jest.fn(),
        useCallback: jest.fn((fn: unknown) => fn),
        useRef: jest.fn((init: unknown) => ({ current: init })),
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProfileEditScreen } = require('./ProfileEditScreen') as typeof import('./ProfileEditScreen');
    const navigateSpy = jest.fn();
    const navWithLoss = {
      ...mockNavigation,
      navigate: navigateSpy,
    };
    const tree = ProfileEditScreen({
      tokenStorage: mockTokenStorage,
      apiBaseUrl: 'https://api.example.com',
      navigation: navWithLoss as never,
      onEditComplete: jest.fn(),
      onSessionExpired: jest.fn(),
    }) as React.ReactElement;

    const link = byTestId(tree, 'loss-entry-link');
    (link!.props as { onPress: () => void }).onPress();
    expect(navigateSpy).toHaveBeenCalledWith('LossConfirm', { profileVersion: 3 });
  });

  it('loss entry link uses T.color.text.primary (ห้องแม่ token, no Clean-palette hex)', () => {
    const tree = renderShowForm(makeProfile('pregnant'));
    const link = byTestId(tree, 'loss-entry-link-text');
    const style = (link!.props as { style?: { color?: string } }).style;
    expect(style?.color).toBe(T.color.text.primary);
  });
});
