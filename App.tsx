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
 *   addNotificationResponseReceivedListener: when user taps a notification,
 *     check data.type ('reminder' | 'appointment') and navigate to Calendar.
 *   navigationRef: module-level NavigationContainerRef so the listener can
 *     navigate without needing access to the navigation prop tree.
 *
 * Security: notification response listener reads data.type only (no health payload).
 *   Do NOT log notification content here.
 */

import React, { useMemo, useEffect } from 'react';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { RootNavigator } from './src/navigation/RootNavigator';
import { SecureTokenStorage } from './src/auth/secureTokenStorage';
import { API_BASE_URL } from './src/config';
import { LanguageProvider } from './src/i18n/LanguageContext';
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

// ─── App component ────────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
  // Create once for the lifetime of the app — every screen that needs tokens
  // receives the same instance via RootNavigator props.
  const tokenStorage = useMemo(() => new SecureTokenStorage(), []);

  // ── Notification response listener (deep-link to Calendar) ────────────────
  //
  // When the user taps a notification (from the lock screen, notification
  // centre, or within the app), navigate to the Calendar screen.
  // We read data.type only (never log health content).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { type?: string }
        | null
        | undefined;
      if (data?.type === 'reminder' || data?.type === 'appointment') {
        if (navigationRef.isReady()) {
          navigationRef.navigate('Calendar');
        }
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <LanguageProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="dark" backgroundColor="#FBF6F1" />
        <RootNavigator
          tokenStorage={tokenStorage}
          apiBaseUrl={API_BASE_URL}
        />
      </NavigationContainer>
    </LanguageProvider>
  );
}
