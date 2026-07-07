/**
 * profileHubSummary — pure helpers for ProfileHubScreen summary-card logic.
 *
 * Extracted so they can be unit-tested in the pure Node/ts-jest environment
 * (no RNTL, no React Native stubs) to prevent the "ships silently broken"
 * class of regression (mobile-reviewer blocking defect §3.3/§10.2).
 *
 * Security: handles only civil dates.  No tokens, no raw health values.
 */

import { computePostpartumAge } from '../pregnancy/postpartumAge';
import type { MessageKey } from '../i18n/messages';

/** Signature that matches useT().t — used in both helpers. */
type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

// ─── Postpartum summary text ──────────────────────────────────────────────────

/**
 * Build the main-text string for the postpartum summary card.
 *
 * Algorithm (spec §3.3 / §10.2):
 *   - If birthDate is present: call computePostpartumAge(birthDate, todayCivil)
 *     and render t('profile.summary.postpartumDays', { n: postpartumDays }).
 *   - If birthDate is absent/null: fall back to t('profile.summary.postpartumFallback').
 *
 * Uses computePostpartumAge (NOT new Date() / raw timezone math) so the
 * civil-date arithmetic is byte-identical to the server and HomeTabScreen.
 *
 * @param birthDate  YYYY-MM-DD civil birth date, or null/undefined if absent.
 * @param todayCivil YYYY-MM-DD device-local civil today (from snapshot.todayCivil).
 * @param t          Translation function from useT() — injected for testability.
 */
export function buildPostpartumSummaryText(
  birthDate: string | null | undefined,
  todayCivil: string,
  t: TFn,
): string {
  if (!birthDate) {
    return t('profile.summary.postpartumFallback');
  }
  const { postpartumDays } = computePostpartumAge(birthDate, todayCivil);
  return t('profile.summary.postpartumDays', { n: postpartumDays });
}

// ─── Logout Alert config builder ─────────────────────────────────────────────

/**
 * AlertButton type — mirrors react-native AlertButton without importing RN.
 * Kept local so the pure helper has no native import dependency.
 */
interface AlertButtonConfig {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

/**
 * AlertArgs — the three arguments passed to Alert.alert() for the logout flow.
 */
export type LogoutAlertArgs = [
  title: string,
  message: string,
  buttons: AlertButtonConfig[],
];

/**
 * Build the Alert.alert() argument tuple for the logout confirmation dialog.
 *
 * Spec §3.6 binding requirement:
 *   - Dialog body MUST use 'profile.logout.message' (consequence statement).
 *   - MUST NOT use 'home.logoutMessage' (yes/no question — different semantics).
 *   - Confirm button onPress MUST be exactly the injected onLogout callback.
 *
 * Extracted so tests can assert both the key choice and the onPress wiring
 * without RNTL or Alert mocks.
 *
 * @param t        Translation function from useT().
 * @param onLogout The shared SD-5 logout runner from BottomTabNavigator.
 */
export function buildLogoutAlertConfig(
  t: TFn,
  onLogout: () => void,
): LogoutAlertArgs {
  return [
    t('home.logoutTitle'),
    t('profile.logout.message'),
    [
      { text: t('home.logoutCancel'), style: 'cancel' },
      {
        text: t('home.logoutConfirm'),
        style: 'destructive',
        onPress: onLogout,
      },
    ],
  ];
}
