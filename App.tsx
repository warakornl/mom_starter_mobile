/**
 * App.tsx — Expo entry point (managed workflow)
 *
 * Responsibilities:
 * 1. Provide the react-navigation NavigationContainer (must be at the root)
 * 2. Create the SecureTokenStorage instance ONCE (useMemo) and pass it down
 *    to RootNavigator so all auth screens share the same storage binding
 * 3. Render StatusBar (expo-status-bar) with the warm-milk theme
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
 */

import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from './src/navigation/RootNavigator';
import { SecureTokenStorage } from './src/auth/secureTokenStorage';
import { API_BASE_URL } from './src/config';

export default function App(): React.JSX.Element {
  // Create once for the lifetime of the app — every screen that needs tokens
  // receives the same instance via RootNavigator props.
  const tokenStorage = useMemo(() => new SecureTokenStorage(), []);

  return (
    <NavigationContainer>
      <StatusBar style="dark" backgroundColor="#FBF6F1" />
      <RootNavigator
        tokenStorage={tokenStorage}
        apiBaseUrl={API_BASE_URL}
      />
    </NavigationContainer>
  );
}
