/**
 * App.tsx — Expo entry point (managed workflow)
 *
 * Responsibilities:
 * 1. Wrap the app in <LanguageProvider> (i18n context — Thai default, persisted)
 * 2. Provide the react-navigation NavigationContainer (must be at the root)
 * 3. Create the SecureTokenStorage instance ONCE (useMemo) and pass it down
 *    to RootNavigator so all auth screens share the same storage binding
 * 4. Render StatusBar (expo-status-bar) with the warm-milk theme
 * 5. Register expo-notifications handler + response listener for deep-link
 * 6. Set up Android notification channel on mount (SD-11: VISIBILITY_PRIVATE)
 *
 * Provider nesting order (outer → inner):
 *   LanguageProvider  — i18n (must be outermost so navigators and screens can call useT())
 *   NavigationContainer — react-navigation
 *   RootNavigator     — screen tree
 *
 * Token storage:
 *   SecureTokenStorage uses expo-secure-store (Keychain on iOS, Keystore on Android).
 *   It is created once here and injected as a prop so every screen (Login, VerifyEmail,
 *   Home logout) operates on the same token pair — no risk of split-brain storage.
 *
 * API base URL:
 *   Sourced from src/config.ts, which auto-resolves the dev machine's LAN IP
 *   from Expo when running in Expo Go — no manual edit needed for same-Wi-Fi UAT.
 *   For standalone EAS builds, set extra.apiBaseUrl in app.json
 *   (see docs/uat-and-build.md §7).
 *
 * Notification deep-link:
 *   setNotificationHandler: all foreground notifications show as alerts.
 *   addNotificationResponseReceivedListener: when user taps a notification
 *     while the app is in foreground / background, navigate to Calendar.
 *   Cold-start (🟡-1): getLastNotificationResponseAsync() handles the case where
 *     the app was killed and the user relaunches it via a notification tap.
 *     If NavigationContainer is not yet ready, the target route is stored in
 *     pendingRoute and navigated on onReady().
 *   navigationRef: module-level NavigationContainerRef so the listener can
 *     navigate without needing access to the navigation prop tree.
 *
 * Security: notification response listener reads data.type only (no health payload).
 *   Do NOT log notification content here.
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { RootNavigator } from './src/navigation/RootNavigator';
import { SecureTokenStorage } from './src/auth/secureTokenStorage';
import { API_BASE_URL } from './src/config';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { setupAndroidNotificationChannel } from './src/notifications/notificationService';
import type { RootStackParamList } from './src/navigation/types';

// ─── Navigation ref (module-level) ────────────────────────────────────────────
//
// Used by the notification response listener so it can navigate without being
// inside a component.  Pattern from the react-navigation deep-link docs.

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// ─── Foreground notification handler ─────────────────────────────────────────
//
// Without setNotificationHandler, Expo does NOT show alerts for foreground
// notifications by default (they are silently received only).
// This configures all foreground local notifications to show as alerts.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Helper — navigate or store pending route ─────────────────────────────────
//
// Used by both the cold-start path and the live listener path so that navigation
// is attempted immediately if the NavigationContainer is ready, or deferred
// (pendingRoute ref) until onReady() fires.
//
// Notifications always deep-link to 'Calendar'; pendingRoute is typed as that
// specific literal rather than keyof RootStackParamList so navigate() type-checks.

function navigateToCalendarWhenReady(
  data: { type?: string } | null | undefined,
  pendingRoute: React.MutableRefObject<'Calendar' | null>,
): void {
  if (data?.type !== 'reminder' && data?.type !== 'appointment') return;
  if (navigationRef.isReady()) {
    navigationRef.navigate('Calendar');
  } else {
    // NavigationContainer not yet mounted — store and navigate in onReady
    pendingRoute.current = 'Calendar';
  }
}

// ─── App component ────────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
  // Create once for the lifetime of the app — every screen that needs tokens
  // receives the same instance via RootNavigator props.
  const tokenStorage = useMemo(() => new SecureTokenStorage(), []);

  // Holds the route to navigate to once NavigationContainer is ready.
  // Only 'Calendar' is ever stored here (notifications always target Calendar).
  const pendingRoute = useRef<'Calendar' | null>(null);

  useEffect(() => {
    // ── Android notification channel (SD-11) ──────────────────────────────
    // No-op on iOS. Safe to call every mount — expo-notifications is idempotent.
    setupAndroidNotificationChannel().catch(() => {});

    // ── Cold-start deep-link (🟡-1) ───────────────────────────────────────
    //
    // If the app was killed (process terminated) and the user taps a notification
    // to re-launch it, addNotificationResponseReceivedListener fires BEFORE the
    // NavigationContainer is ready and its event is lost.
    // getLastNotificationResponseAsync() retrieves that stored response so we can
    // navigate once the container is available (via pendingRoute + onReady).
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as
          | { type?: string }
          | null
          | undefined;
        navigateToCalendarWhenReady(data, pendingRoute);
      })
      .catch(() => {}); // non-fatal — cold-start nav is best-effort

    // ── Live notification response listener (foreground / background) ─────
    //
    // When the user taps a notification while the app is already running,
    // navigate to Calendar immediately (or defer if container isn't ready yet).
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { type?: string }
        | null
        | undefined;
      navigateToCalendarWhenReady(data, pendingRoute);
    });

    return () => sub.remove();
  }, []);

  return (
    <LanguageProvider>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          // Drain the pending cold-start route (if any) once the container is ready
          if (pendingRoute.current) {
            navigationRef.navigate(pendingRoute.current);
            pendingRoute.current = null;
          }
        }}
      >
        <StatusBar style="dark" backgroundColor="#FBF6F1" />
        <RootNavigator
          tokenStorage={tokenStorage}
          apiBaseUrl={API_BASE_URL}
        />
      </NavigationContainer>
    </LanguageProvider>
  );
}
