/**
 * App.tsx — Expo entry point (managed workflow)
 *
 * Responsibilities:
 * 1. Load Thai + EN fonts (Sarabun 400/600 + Fraunces 600) via useFonts.
 *    Gate splash screen until fonts are ready (§2.2 mother-room-build-spec.md).
 *    Fraunces failure degrades gracefully to Sarabun-SemiBold (§2.2 / fontPlan.ts).
 * 2. Wrap the app in <LanguageProvider> (i18n context — Thai default, persisted)
 * 3. Provide the react-navigation NavigationContainer (must be at the root)
 * 4. Create the SecureTokenStorage instance ONCE (useMemo) and pass it down
 *    to RootNavigator so all auth screens share the same storage binding
 * 5. Render StatusBar (expo-status-bar) with the warm-milk theme
 * 6. Configure consent store + queue persistence at startup (B1 + B2):
 *    - consentStore.configurePersistence() — loads/saves consent state via
 *      expo-secure-store so cold-start GET failures keep the cached state (§4.5.4)
 *    - configureConsentQueueStorage() — durable queue storage so queued consent
 *      POSTs survive app-kill restarts and are drained on foreground (§4.2.4)
 *
 * Font loading (mother-room-build-spec.md §2):
 *   Fonts: @expo-google-fonts/sarabun (400, 600) + @expo-google-fonts/fraunces (600).
 *   Fraunces italic SKIPPED per design-reviewer nit.
 *   useFonts via expo-font; SplashScreen gate via expo-splash-screen.
 *   Fallback chain on failure: Sarabun-SemiBold → Thonburi (iOS) / Noto Sans Thai (Android).
 *
 * Provider nesting order (outer → inner):
 *   LanguageProvider  — i18n (must be outermost so navigators and screens can call useT())
 *   NavigationContainer — react-navigation
 *   RootNavigator     — screen tree
 *
 * Security: no secrets logged; no health data in route params (SD-9).
 */

// MUST be first — polyfills global.crypto.getRandomValues (uuid.v4 throws without
// it on Hermes, which silently broke every create handler). See src/polyfills/crypto.ts.
import './src/polyfills/crypto';

import React, { useMemo, useEffect, useCallback, useRef } from 'react';
import { Linking, AppState, type AppStateStatus } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNavigationContainerRef } from '@react-navigation/core';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import { useFonts } from 'expo-font';
import {
  Sarabun_400Regular,
  Sarabun_600SemiBold,
} from '@expo-google-fonts/sarabun';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';

import { RootNavigator } from './src/navigation/RootNavigator';
import { SecureTokenStorage } from './src/auth/secureTokenStorage';
import { API_BASE_URL } from './src/config';
import { T } from './src/theme/tokens';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { consentStore } from './src/consent/consentStore';
import { configureConsentQueueStorage, restoreConsentQueue } from './src/consent/consentSync';
import {
  configureProfileVerbQueueStorage,
  restoreProfileVerbQueue,
} from './src/pregnancy/profileVerbSyncSingleton';
import { suggestionStore } from './src/suggestion/suggestionStore';
import type { RootStackParamList } from './src/navigation/types';
import { parseResetTokenFromUrl, setResetToken } from './src/deepLink/resetDeepLink';
import {
  attachCalendarObserver,
  syncCalendarBridgeConsentFromStore,
  configureCalendarPostConsent,
  checkAndUpdateOsPermission,
  initCalendarPersistenceFromStorage,
} from './src/deviceCalendar/deviceCalendarSingleton';
import { createConsentApiClient } from './src/consent/consentApiClient';

// ─── Splash screen — prevent auto-hide until fonts are ready (§2.2) ───────────
// Must be called before any component renders.
SplashScreen.preventAutoHideAsync().catch(() => {
  // preventAutoHideAsync may fail if the splash is already hidden (hot-reload).
  // Non-fatal — continue normally.
});

// ─── Navigation ref (for imperative navigation from deep-link handler) ─────────
//
// PDPA SD-9 / MI-1: The navigation ref allows the deep-link handler (below) to
// navigate to ResetPassword without putting the token in route params.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// ─── Consent persistence setup (B1 + B2) ─────────────────────────────────────

const CONSENT_STATE_KEY = 'consent_state_v1';
const CONSENT_QUEUE_KEY = 'consent_queue_v1';
const SUGGESTION_STATE_KEY = 'suggestion_state_v1';
const PROFILE_VERB_QUEUE_KEY = 'profile_verb_queue_v1';

consentStore.configurePersistence({
  save: (json: string) => SecureStore.setItemAsync(CONSENT_STATE_KEY, json),
  load: () => SecureStore.getItemAsync(CONSENT_STATE_KEY),
});

suggestionStore.configurePersistence({
  save: (json: string) => SecureStore.setItemAsync(SUGGESTION_STATE_KEY, json),
  load: () => SecureStore.getItemAsync(SUGGESTION_STATE_KEY),
});

configureConsentQueueStorage({
  save: (json: string) => SecureStore.setItemAsync(CONSENT_QUEUE_KEY, json),
  load: () => SecureStore.getItemAsync(CONSENT_QUEUE_KEY),
});

void restoreConsentQueue();

// profileVerbQueue (OR-STRUCT-1 / functional-spec §17.2): same at-rest
// posture as the consent queue (expo-secure-store now; encrypted SQLite
// when it lands). Restored at startup so a verb queued in a prior session
// that never reached HomeTabScreen still drains (NO headless-while-killed
// send — this only RESTORES into memory; the actual drain happens on the
// next AppState 'active' foreground, which HomeTabScreen also triggers
// once it mounts and receives its first 'active' event).
configureProfileVerbQueueStorage({
  save: (json: string) => SecureStore.setItemAsync(PROFILE_VERB_QUEUE_KEY, json),
  load: () => SecureStore.getItemAsync(PROFILE_VERB_QUEUE_KEY),
});

void restoreProfileVerbQueue();

// ─── Device-calendar bridge: wire the appointment observer (architecture §2) ───
//
// This ONE call is what makes the calendar-sync feature live. Without it the
// bridge exists but is never triggered — appointments created/edited/deleted in
// the app would not propagate to the device calendar.
//
// Runs at module-eval time (before any component mounts) so the observer is in
// place before the first appointment write can happen on this JS session.
//
// After consentStore loads its persisted state (loadFromStorage, below),
// syncCalendarBridgeConsentFromStore() opens the gate for previously-consented
// users without waiting for a network refresh (CAL-GATE-FRESH Option B).
attachCalendarObserver();

// Load calendarMapStore + settings from durable storage (BLOCKER 3 fix).
// Without this, the map is empty on each relaunch → backfill creates duplicates.
// Also syncs the bridge's feature-toggle gate with the persisted featureEnabled value.
void initCalendarPersistenceFromStorage();

// Sync bridge consent snapshot from the persisted cache.
// consentStore.loadFromStorage() is async; we schedule it and sync after.
// On first cold-start (empty cache) the bridge stays fail-closed ('unknown').
// On subsequent launches the bridge opens with the cached granted state before
// any network request completes — fully offline-safe.
void consentStore.loadFromStorage().then(() => {
  syncCalendarBridgeConsentFromStore();
});

export default function App(): React.JSX.Element | null {
  const tokenStorage = useMemo(() => new SecureTokenStorage(), []);

  // ─── Calendar bridge: configure postConsent fn (BLOCKER 1 fix) ───────────────
  //
  // configureCalendarPostConsent wires the real POST /account/consents function
  // into the bridge's postConsent slot. This must be called once the tokenStorage
  // instance is available (useMemo above). Uses the same pattern as all other
  // API clients: acquire token at call time, not at construction time.
  //
  // INV-CAL-2: the postConsent fn sends only consent metadata (type, granted, version)
  // — no health data, no appointment data.
  useEffect(() => {
    const consentClient = createConsentApiClient(API_BASE_URL);
    configureCalendarPostConsent(async (body) => {
      try {
        const tokens = await tokenStorage.load();
        if (!tokens?.accessToken) return { ok: false };
        // consentApiClient.postConsent signature: (type, granted, version, token)
        const result = await consentClient.postConsent(
          body.consentType,
          body.granted,
          body.consentTextVersion,
          tokens.accessToken,
        );
        return { ok: result.ok };
      } catch {
        return { ok: false };
      }
    });
  }, [tokenStorage]);

  // ─── AppState foreground handler: check OS calendar permission ───────────────
  //
  // When the app returns to foreground, the user may have changed calendar
  // permission in iOS Settings or Android app settings. We check and update
  // the bridge's OS permission gate so no stale-permission writes are attempted.
  // Also refreshes the consent gate from the local store cache (self-heal path B).
  //
  // This does NOT do a network request — it checks the current OS permission
  // via expo-calendar (synchronous-equivalent). The consent refresh (CAL-SA-30)
  // is handled when ManageConsentsScreen opens (it calls GET /account/consents).
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        // App came to foreground — refresh OS permission state in the bridge.
        void checkAndUpdateOsPermission();
        // Also re-sync consent snapshot in case a background push updated the
        // local consentStore (e.g. after a silent consent refresh).
        syncCalendarBridgeConsentFromStore();
      }
      appState.current = nextState;
    });
    return () => { sub.remove(); };
  }, []);

  // ─── Font loading — Sarabun 400/600 + Fraunces 600 (§2.1) ─────────────────
  //
  // Wave-4 rule: installed via `npx expo install`, not bare npm install.
  // Fraunces italic SKIPPED per design-reviewer nit (reviewer confirmed optional).
  // If Fraunces fails to load, the app continues — Sarabun-SemiBold is the fallback
  // (FRAUNCES_IS_OPTIONAL = true in fontPlan.ts / §2.2).
  // If Sarabun fails: log (never expose) and continue with system fallback.
  const [fontsLoaded, fontError] = useFonts({
    'Sarabun-Regular':   Sarabun_400Regular,
    'Sarabun-SemiBold':  Sarabun_600SemiBold,
    'Fraunces-SemiBold': Fraunces_600SemiBold,
  });

  // §2.2 font error handling:
  //   Sarabun error → log and continue with system fallback (do not block).
  //   Fraunces error → degrade silently to Sarabun-SemiBold (non-blocking).
  // Security: never log the fontError object if it contains PII paths.
  useEffect(() => {
    if (fontError) {
      // Non-blocking: log at warn level, never block navigation.
      // If only Fraunces failed, Sarabun still loaded correctly.
      // Do not log the full error object (may contain file paths).
      // eslint-disable-next-line no-console
      console.warn('[fonts] Font load warning — continuing with fallback');
    }
  }, [fontError]);

  // ─── Splash gate — hide when fonts are ready ─────────────────────────────────
  // §2.2: "Gate the root navigator render on fontsLoaded."
  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync().catch(() => {
        // hideAsync may fail on hot-reload — non-fatal.
      });
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    void onLayoutRootView();
  }, [onLayoutRootView]);

  // ─── Deep-link handler — reset-password (MI-1…MI-5) ─────────────────────────
  useEffect(() => {
    function handleUrl(url: string | null): void {
      if (!url) return;
      const token = parseResetTokenFromUrl(url);
      if (token) {
        setResetToken(token);
        if (navigationRef.isReady()) {
          navigationRef.navigate('ResetPassword');
        }
      }
    }

    Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {
        // getInitialURL failure is non-fatal.
      });

    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => { subscription.remove(); };
  }, []);

  // §2.2: Gate render on font ready. null = splash visible (native gate).
  // fontError: if Sarabun failed we still render (system fallback covers).
  // fontsLoaded: both Sarabun + Fraunces loaded (or fontError = Fraunces-only failure).
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <LanguageProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="dark" backgroundColor={T.color.surface.base} />
        <RootNavigator
          tokenStorage={tokenStorage}
          apiBaseUrl={API_BASE_URL}
        />
      </NavigationContainer>
    </LanguageProvider>
  );
}
