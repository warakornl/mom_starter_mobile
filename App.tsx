/**
 * App.tsx — Expo entry point (managed workflow)
 *
 * Responsibilities:
 * 1. Wrap the app in <LanguageProvider> (i18n context — Thai default, persisted)
 * 2. Provide the react-navigation NavigationContainer (must be at the root)
 * 3. Create the SecureTokenStorage instance ONCE (useMemo) and pass it down
 *    to RootNavigator so all auth screens share the same storage binding
 * 4. Render StatusBar (expo-status-bar) with the warm-milk theme
 * 5. Configure consent store + queue persistence at startup (B1 + B2):
 *    - consentStore.configurePersistence() — loads/saves consent state via
 *      expo-secure-store so cold-start GET failures keep the cached state (§4.5.4)
 *    - configureConsentQueueStorage() — durable queue storage so queued consent
 *      POSTs survive app-kill restarts and are drained on foreground (§4.2.4)
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
 * Consent storage:
 *   Consent flags are NOT secrets (PDPA non-sensitive metadata). They use
 *   expo-secure-store for simplicity (already a dependency). Both the state store
 *   and the retry queue are backed by expo-secure-store via injectable interfaces
 *   so these modules never import native code directly (keeps tests clean).
 *
 * API base URL:
 *   Sourced from src/config.ts, which auto-resolves the dev machine's LAN IP
 *   from Expo when running in Expo Go — no manual edit needed for same-Wi-Fi UAT.
 *   For standalone EAS builds, set extra.apiBaseUrl in app.json
 *   (see docs/uat-and-build.md §7).
 */

// MUST be first — polyfills global.crypto.getRandomValues (uuid.v4 throws without
// it on Hermes, which silently broke every create handler). See src/polyfills/crypto.ts.
import './src/polyfills/crypto';

import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';

import { RootNavigator } from './src/navigation/RootNavigator';
import { SecureTokenStorage } from './src/auth/secureTokenStorage';
import { API_BASE_URL } from './src/config';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { consentStore } from './src/consent/consentStore';
import { configureConsentQueueStorage } from './src/consent/consentSync';

// ─── Consent persistence setup (B1 + B2) ─────────────────────────────────────
//
// Wire durable SecureStore bindings once at module level (before any render).
// The modules themselves never import expo-secure-store so tests stay mock-free.

const CONSENT_STATE_KEY = 'consent_state_v1';
const CONSENT_QUEUE_KEY = 'consent_queue_v1';

// B1: consent state store persistence — enables cold-start cache (§4.5.4)
consentStore.configurePersistence({
  save: (json: string) => SecureStore.setItemAsync(CONSENT_STATE_KEY, json),
  load: () => SecureStore.getItemAsync(CONSENT_STATE_KEY),
});

// B2: consent queue durable storage — queue survives app-kill restarts (§4.2.4)
configureConsentQueueStorage({
  save: (json: string) => SecureStore.setItemAsync(CONSENT_QUEUE_KEY, json),
  load: () => SecureStore.getItemAsync(CONSENT_QUEUE_KEY),
});

export default function App(): React.JSX.Element {
  // Create once for the lifetime of the app — every screen that needs tokens
  // receives the same instance via RootNavigator props.
  const tokenStorage = useMemo(() => new SecureTokenStorage(), []);

  return (
    <LanguageProvider>
      <NavigationContainer>
        <StatusBar style="dark" backgroundColor="#FBF6F1" />
        <RootNavigator
          tokenStorage={tokenStorage}
          apiBaseUrl={API_BASE_URL}
        />
      </NavigationContainer>
    </LanguageProvider>
  );
}
