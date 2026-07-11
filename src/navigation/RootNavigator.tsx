/**
 * RootNavigator — root native-stack navigator.
 *
 * Route map (v2, bottom-tab-navigation-design.md v2.1):
 *   Welcome → Login | Register
 *   Login → MainTabs (on success)
 *   Register → VerifyEmail (on 202)
 *   VerifyEmail → Consent (on verify success)
 *   Consent → MainTabs (on continue — limited mode or full mode)
 *   MainTabs — BottomTabNavigator (5 tabs: Supplies, Expenses, Home (center), Calendar, Medication)
 *     Home tab — dashboard + snapshot-population path (v2):
 *       → ProfileSetup (if GET 404; tab bar suppressed — ProfileSetup is a root screen)
 *       → stays in tabs (if profile exists — pregnant or postpartum)
 *       → DoctorReport (entry row "รายงานสำหรับแพทย์ ›")
 *     Home tab (T3, lifecycle=pregnant) — "ลูกคลอดแล้ว" banner CTA:
 *       → BirthEvent (profile version passed as route param)
 *     Calendar tab — CalendarScreen DIRECT (no wrapper; fixes nested ScrollView bug §3A)
 *   DoctorReport — root-stack screen hosting DoctorPdfScreen (§8A):
 *       → entered from Home tab "รายงานสำหรับแพทย์ ›" row
 *       → navigation.goBack() on onBack
 *   ProfileSetup — initial due-date / current-week entry:
 *       → MainTabs (on PUT success; resets stack to tabs)
 *   BirthEvent — records POST /v1/pregnancy-profile/birth-event:
 *       → MainTabs (on success; resets stack; Home tab reloads on focus → postpartum)
 *
 * Design decisions:
 *   - Auth screens keep callback-based prop API (decouples from navigation, stays testable).
 *   - Profile snapshot is now hosted in PregnancyProfileContext ABOVE the tab navigator.
 *     HomeTabScreen updates it via useProfileSnapshotSetter() (v2; was CalendarTabScreen).
 *     Non-tab screens (KickCount*, Settings, DoctorReport, Suggestions) read via useProfileSnapshot().
 *   - Supplies, Expenses, MedicationPlans are TABS inside BottomTabNavigator.
 *   - DoctorReport is now a ROOT-STACK SCREEN (not a tab) — spec §8A, OQ-NAV-4.
 *   - profileSnapshot state removed from RootNavigator (was B-1 pattern from old Home).
 *     PregnancyProfileContext replaces it — same security properties (no tokens, no raw health).
 *
 * i18n: Navigator header titles sourced from useT() so they update on locale change.
 *
 * PDPA / SD-5: performLogout runner called from BottomTabNavigator and ProfileEditScreen
 *   for all exit paths to ensure all health stores are cleared.
 */

import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import type { TokenStorage } from '../auth/tokenStorage';
import type { Lifecycle } from '../pregnancy/types';
import { T } from '../theme/tokens';
import { localCivilToday } from '../pregnancy/gestationalAge';
import { PregnancyProfileProvider, useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import type { AncFormPrefill } from '../suggestion/types';
import { hasUpcomingAncApptInWindow } from '../suggestion/ancUpcomingApptSelector';

import { WelcomeScreen } from '../screens/WelcomeScreen';
import { LoginScreen } from '../auth/LoginScreen';
import { RegisterScreen } from '../auth/RegisterScreen';
import { VerifyEmailScreen } from '../auth/VerifyEmailScreen';
import { ForgotPasswordScreen } from '../auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../auth/ResetPasswordScreen';
import { setPendingLoginSuccessToast } from '../auth/loginSuccessToast';
import { ProfileSetupScreen } from '../pregnancy/ProfileSetupScreen';
import { ProfileEditScreen } from '../pregnancy/ProfileEditScreen';
import { ProfileInfoEditScreen } from '../pregnancy/ProfileInfoEditScreen';
import { BirthEventScreen } from '../pregnancy/BirthEventScreen';
import { LossConfirmScreen } from '../pregnancy/LossConfirmScreen';
import { ReopenConfirmScreen } from '../pregnancy/ReopenConfirmScreen';
import { AppointmentFormScreen } from '../calendar/AppointmentFormScreen';
import { ReminderFormScreen } from '../calendar/ReminderFormScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { KickCountHomeScreen } from '../kickCount/KickCountHomeScreen';
import { KickCountCountingScreen } from '../kickCount/KickCountCountingScreen';
import { KickCountSummaryScreen } from '../kickCount/KickCountSummaryScreen';
import { KickCountHistoryScreen } from '../kickCount/KickCountHistoryScreen';
import { KickCountDetailScreen } from '../kickCount/KickCountDetailScreen';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { resetTokenStore, clearResetToken } from '../deepLink/resetDeepLink';
import { ConsentScreen } from '../screens/ConsentScreen';
import { ManageConsentsScreen } from '../screens/ManageConsentsScreen';
import { SuggestionFlowScreen } from '../suggestion/SuggestionFlowScreen';
import { CaptureScreen } from '../capture/CaptureScreen';
import { DoctorPdfScreen } from '../pdfReport/DoctorPdfScreen';
import { PregnancySummaryScreen } from '../pregnancy/PregnancySummaryScreen';
import { AutoDecrementSettingsScreen } from '../autoStockDecrement/AutoDecrementSettingsScreen';
import { SubUnitSetupScreen } from '../autoStockDecrement/SubUnitSetupScreen';
import { FeedingLogScreen } from '../autoStockDecrement/FeedingLogScreen';
import { SupplyItemPickerScreen } from '../autoStockDecrement/SupplyItemPickerScreen';
import { BottomTabNavigator } from './BottomTabNavigator';
import { useT } from '../i18n/LanguageContext';
import { DOCTOR_REPORT_ROUTE_OPTIONS } from './doctorReportRouteOptions';
import { CalendarSyncSettingsScreen } from '../deviceCalendar/screens/CalendarSyncSettingsScreen';
import { CalendarSyncConsentSheet } from '../deviceCalendar/screens/CalendarSyncConsentSheet';
import { CalendarSyncPrivacyLevelScreen } from '../deviceCalendar/screens/CalendarSyncPrivacyLevelScreen';
import {
  deviceCalendarBridge,
  syncCalendarBridgeConsentFromStore,
  backfillCalendarFromStore,
  changePrivacyLevel,
  getCalendarSyncSnapshot,
} from '../deviceCalendar/deviceCalendarSingleton';

// ── Logout deps for SD-5 teardown (used by ProfileEditScreen) ─────────────────
import { performLogout } from '../auth/performLogout';
import { createPregnancyClient } from '../pregnancy/pregnancyApiClient';
import { decodeDateFromWire } from '../pregnancy/hospitalStayCipher';
import { supplySyncStore } from '../sync/supplySyncStore';
import { kickCountSyncStore } from '../kickCount/kickCountSyncStore';
import { clearDraft } from '../kickCount/kickCountDraftStore';
import { consentStore } from '../consent/consentStore';
import { resetConsentQueue } from '../consent/consentSync';
import { suggestionStore } from '../suggestion/suggestionStore';
import { expensesSyncStore } from '../expenses/expensesSyncStore';
import { selfLogSyncStore } from '../selfLog/selfLogSyncStore';
import { medicationPlanSyncStore } from '../medication/medicationPlanSyncStore';
import { medicationLogSyncStore } from '../medication/medicationLogSyncStore';
import { consumptionMappingStore } from '../autoStockDecrement/consumptionMappingStore';
import { stockDecrementMarkerStore } from '../autoStockDecrement/stockDecrementMarkerStore';

const Stack = createNativeStackNavigator<RootStackParamList>();

// ─── PregnancySummaryWrapper — SD-9-safe GET-on-mount container ───────────────
//
// SD-9: health data (edd, birthDate, deliveryType, hospitalAdmission/DischargeDate)
//   MUST NOT go in route params. This wrapper performs GET /v1/pregnancy-profile
//   on mount, decodes cipher fields client-side, and passes decoded data to the
//   approved PregnancySummaryScreen component (whose computation is approved and
//   unchanged). Route params for this screen are `undefined`.
//
// SD-5: GET 401 (no token or server-expired) → onSessionExpired → performLogout.
//
// Mirrors ProfileInfoEditScreen's GET-on-mount pattern:
//   tokenStorage.load() → accessToken → getProfile() → decode → render screen.
//
// K-8 / PDPA: decoded health values are passed to PregnancySummaryScreen ONLY.
//   NEVER logged. NEVER stored in route params or navigation state.

type PregnancySummaryLoadState =
  | { mode: 'loading' }
  | {
      mode: 'ready';
      edd: string | null;
      birthDate: string | null;
      /** MVP: plaintext (TODO: AES-GCM decode when cipher ships). NEVER log. */
      deliveryType: string | null;
      /** Decoded from Base64 cipher. NEVER log. */
      hospitalAdmissionDate: string | null;
      /** Decoded from Base64 cipher. NEVER log. */
      hospitalDischargeDate: string | null;
    }
  | { mode: 'error'; message: string };

interface PregnancySummaryWrapperProps {
  tokenStorage: TokenStorage;
  apiBaseUrl: string;
  onBack: () => void;
  onSetEdd: () => void;
  onSessionExpired: () => void;
  /** B4 loss gate: passed from snapshot?.lifecycle — undefined when profile not yet loaded. */
  lifecycle?: Lifecycle | null;
}

/**
 * PregnancySummaryWrapper — thin container that GETs pregnancy profile on mount
 * and renders PregnancySummaryScreen with decoded health data.
 *
 * This component is the ONLY place where health data is decoded for display on
 * PregnancySummaryScreen. It must NOT log or persist any decoded value.
 */
function PregnancySummaryWrapper({
  tokenStorage,
  apiBaseUrl,
  onBack,
  onSetEdd,
  onSessionExpired,
  lifecycle,
}: PregnancySummaryWrapperProps): React.JSX.Element {
  const { t } = useT();
  const [loadState, setLoadState] = useState<PregnancySummaryLoadState>({ mode: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(): Promise<void> {
      // SD-5: no token → treat as 401, trigger session-expired teardown
      const tokens = await tokenStorage.load();
      const accessToken = tokens?.accessToken;
      if (!accessToken) {
        if (!cancelled) onSessionExpired();
        return;
      }

      const client = createPregnancyClient(apiBaseUrl);
      const result = await client.getProfile(accessToken, localCivilToday());

      if (cancelled) return;

      if (result.ok) {
        const { profile } = result;
        // SD-9: decode cipher fields here — NEVER in route params.
        // K-8 / PDPA: NEVER log decoded values (health PII / health-adjacent PII).
        setLoadState({
          mode: 'ready',
          edd: profile.edd,
          birthDate: profile.birthDate ?? null,
          // deliveryType: MVP plaintext (TODO: AES-GCM decode when appsec ships cipher).
          deliveryType: profile.deliveryType ?? null,
          // hospitalAdmissionDate / hospitalDischargeDate: Base64 → decode client-side.
          hospitalAdmissionDate: decodeDateFromWire(profile.hospitalAdmissionDate),
          hospitalDischargeDate: decodeDateFromWire(profile.hospitalDischargeDate),
        });
      } else if (!result.ok && result.status === 401) {
        // SD-5: 401 (no token or server-expired) → full performLogout teardown
        onSessionExpired();
      } else {
        setLoadState({ mode: 'error', message: !result.ok ? result.message : 'Unknown error' });
      }
    }

    void loadProfile();
    return (): void => {
      cancelled = true;
    };
  }, [tokenStorage, apiBaseUrl, onSessionExpired]);

  if (loadState.mode === 'loading') {
    return (
      <View style={pregnancySummaryWrapperStyles.center}>
        <ActivityIndicator size="small" color={T.color.accent.interactive} />
        <Text style={pregnancySummaryWrapperStyles.loadingText}>{t('home.loading')}</Text>
      </View>
    );
  }

  if (loadState.mode === 'error') {
    return (
      <View style={pregnancySummaryWrapperStyles.center}>
        <Text style={pregnancySummaryWrapperStyles.errorText}>{loadState.message}</Text>
      </View>
    );
  }

  // loadState.mode === 'ready' — pass decoded data to the approved screen.
  // SD-9: all health data comes from this GET result, NOT from route params.
  // B4 loss gate: lifecycle comes from snapshot?.lifecycle (NOT the GET result) so
  // partialNote is suppressed immediately when lifecycle='ended', even before profile loads.
  return (
    <PregnancySummaryScreen
      edd={loadState.edd}
      birthDate={loadState.birthDate}
      deliveryType={loadState.deliveryType}
      hospitalAdmissionDate={loadState.hospitalAdmissionDate}
      hospitalDischargeDate={loadState.hospitalDischargeDate}
      lifecycle={lifecycle}
      onBack={onBack}
      onSetEdd={onSetEdd}
    />
  );
}

const pregnancySummaryWrapperStyles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.color.surface.base,
    gap: 12,
  },
  loadingText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.body.size,
    color: T.color.text.primary,
  },
  errorText: {
    fontFamily: T.type.body.fontFamily,
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});

interface RootNavigatorProps {
  /** Secure token storage shared across all auth screens. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
}

// ─── Inner navigator (reads from context) ────────────────────────────────────

/**
 * StackNavigator uses useProfileSnapshot() to pass props to non-tab screens.
 * It must render inside <PregnancyProfileProvider> so the context is available.
 */
function StackNavigator({ tokenStorage, apiBaseUrl }: RootNavigatorProps): React.JSX.Element {
  const { t } = useT();

  // Read profile snapshot from context (updated by HomeTabScreen after GET profile, v2).
  // Safe defaults before the profile loads (same as old kickProps pattern).
  const snapshot = useProfileSnapshot();
  const kickProps = snapshot ?? {
    gestationalWeek: 0,
    edd: '',
    todayCivil: localCivilToday(),
    lifecycle: 'pregnant' as const,
    generalHealthConsented: false,
  };

  /**
   * FIX2 — PDPA SD-9: ANC prefill is health-adjacent (EDD-derived date, appointment
   * category). It must NOT go into route params (which may be logged/serialised by
   * navigation tooling). Instead we hold it in a useRef here and inject it at the
   * AncAppointmentForm screen render level — the same pattern used for edd/week in
   * kick-count screens. The ref is mutated synchronously before navigation.navigate()
   * so it is always populated by the time the screen mounts.
   */
  const ancPrefillRef = useRef<AncFormPrefill | null>(null);

  // ─── Calendar sync state (BLOCKER 1 fix) ──────────────────────────────────
  //
  // Reactive state for the CalendarSyncSettingsScreen props. Initialized from
  // the singleton's current settings + consentStore state. Each handler updates
  // this after the bridge method returns so the screen re-renders with fresh state.
  //
  // SD-9: no health data stored here — only feature flags and privacy level.
  // SECURITY: osPermissionGranted reflects the OS state, not health consent.
  const [calSyncState, setCalSyncState] = useState(() => getCalendarSyncSnapshot());

  /** Refresh calSyncState from the singleton's current state (call after any handler). */
  const refreshCalSyncState = React.useCallback(() => {
    setCalSyncState(getCalendarSyncSnapshot());
  }, []);

  /**
   * onGrantConsent — called when the consent sheet's "Grant" button is tapped.
   *
   * Explainer-before-prompt (CAL-SCR-10): the consent sheet IS the explainer.
   * After the user taps Grant:
   *   1. POST consent granted (NO OS prompt yet — only metadata sent, INV-CAL-2)
   *   2. Update local consentStore + bridge snapshot (opens consent gate)
   *   3. Request OS calendar permission (OS prompt fires HERE, after explainer)
   *   4. Backfill future appointments if feature enabled successfully
   */
  const handleCalGrantConsent = React.useCallback(async (): Promise<void> => {
    // 1. POST consent granted (no health data in body — INV-CAL-2)
    await deviceCalendarBridge.grantConsent('v1.0');
    // 2. Update local consent state and sync to bridge
    consentStore.setGranted('calendar_sync', true, 'v1.0');
    syncCalendarBridgeConsentFromStore();
    // 3. Request OS permission + enable feature (OS prompt fires inside enableFeature)
    const result = await deviceCalendarBridge.enableFeature();
    // 4. Backfill future appointments if the OS permission was granted
    if (result === 'ok') {
      await backfillCalendarFromStore(localCivilToday());
    }
    refreshCalSyncState();
  }, [refreshCalSyncState]);

  /**
   * onToggleOn — called when the user toggles ON and consent is already granted.
   * Requests OS permission and enables the feature (no consent POST needed).
   */
  const handleCalToggleOn = React.useCallback(async (): Promise<void> => {
    const result = await deviceCalendarBridge.enableFeature();
    if (result === 'ok') {
      await backfillCalendarFromStore(localCivilToday());
    }
    refreshCalSyncState();
  }, [refreshCalSyncState]);

  /**
   * onDisableFeature — US-9 disable flow.
   * Stops syncing, deletes or keeps existing native events, withdraws consent.
   */
  const handleCalDisableFeature = React.useCallback(
    async (action: 'delete' | 'keep'): Promise<void> => {
      await deviceCalendarBridge.disableAndWithdraw(action, 'v1.0');
      // Withdraw from local consent store too
      consentStore.setGranted('calendar_sync', false, 'v1.0');
      syncCalendarBridgeConsentFromStore();
      refreshCalSyncState();
    },
    [refreshCalSyncState],
  );

  /**
   * onLevelSelected — AC-5.2 re-mask sweep using calendarSyncStore appointments.
   */
  const handleCalPrivacyLevelSelected = React.useCallback(
    async (level: 'generic' | 'descriptive'): Promise<void> => {
      await changePrivacyLevel(level);
      refreshCalSyncState();
    },
    [refreshCalSyncState],
  );

  return (
    <Stack.Navigator
      initialRouteName="Welcome"
      screenOptions={{
        headerStyle: { backgroundColor: '#FBF6F1' },
        headerTintColor: '#3A2A30',
        headerTitleStyle: { fontFamily: 'IBMPlexSans-SemiBold' },
        contentStyle: { backgroundColor: '#FBF6F1' },
      }}
    >
      {/* Welcome / Landing */}
      <Stack.Screen
        name="Welcome"
        component={WelcomeScreen}
        options={{ headerShown: false }}
      />

      {/* Login (S4) */}
      <Stack.Screen
        name="Login"
        options={{ title: t('login.title'), headerBackTitle: '' }}
      >
        {({ navigation }) => (
          <LoginScreen
            apiBaseUrl={apiBaseUrl}
            tokenStorage={tokenStorage}
            onSuccess={() =>
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
            }
            onForgotPassword={() => navigation.navigate('ForgotPassword')}
            onCreateAccount={() => navigation.navigate('Register')}
          />
        )}
      </Stack.Screen>

      {/* ForgotPassword (S5) — email entry for password reset.
       *
       * Route: ForgotPassword (root stack, unauthenticated).
       * Params: { prefillEmail?: string } — optional email from LoginScreen.
       * No token material in params (MI-1). Deep-link for this screen is not
       * needed; deep-link target is ResetPassword (see below + App.tsx).
       *
       * onDone: "Back to sign in" from confirmation → Login.
       * onBackToLogin: native back / header back → Login (goBack()).
       */}
      <Stack.Screen
        name="ForgotPassword"
        options={{ title: t('forgot.navTitle'), headerBackTitle: '' }}
      >
        {({ route, navigation }) => (
          <ForgotPasswordScreen
            apiBaseUrl={apiBaseUrl}
            prefillEmail={route.params?.prefillEmail}
            onDone={() => navigation.navigate('Login')}
            onBackToLogin={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* ResetPassword — set new password via deep-link token.
       *
       * Route: ResetPassword (root stack, unauthenticated, no params — MI-1).
       * Token is held in `resetTokenStore` (module-level ref, SD-9 pattern),
       * NOT in route params. App.tsx sets resetTokenStore.current before
       * navigating here; we read it at render time (same as ancPrefillRef).
       *
       * MI-5 token lifecycle:
       *   - success: clearResetToken() before performLogout + Login
       *   - 410: clearResetToken() + navigate to ForgotPassword
       *   - unmount: the ref is module-level; caller clears as above
       *
       * MI-7 post-success teardown: on 204, handleResetPassword already calls
       * tokenStorage.clear(). The full SD-5 teardown (all health stores) is
       * performed here via performLogout, matching the existing onSessionExpired
       * pattern in ProfileEditScreen / ProfileInfoEditScreen.
       */}
      <Stack.Screen
        name="ResetPassword"
        options={{ title: t('reset.navTitle'), headerBackTitle: '', headerBackVisible: false }}
      >
        {({ navigation }) => (
          <ResetPasswordScreen
            apiBaseUrl={apiBaseUrl}
            tokenStorage={tokenStorage}
            // MI-1: token injected from module-level ref, NOT route param
            token={resetTokenStore.current}
            onSuccess={() => {
              // MI-5: clear the token ref before teardown
              clearResetToken();
              // MI-7 / SEC-INV-4: reset revoked ALL devices server-side.
              // Run the full SD-5 performLogout teardown so the local DEK/
              // SecureStore and ALL health stores are wiped (not just the
              // refresh token). Then navigate to Login + show successToast.
              void performLogout({
                clearTokens: () => tokenStorage.clear(),
                resetSupplyStore: () => supplySyncStore.reset(),
                resetKickCountStore: () => kickCountSyncStore.reset(),
                resetCalendarStore: () => calendarSyncStore.reset(),
                resetSelfLogStore: () => selfLogSyncStore.reset(),
                resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
                resetMedicationLogStore: () => medicationLogSyncStore.reset(),
                resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
                resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
                resetConsentStore: () => consentStore.reset(),
                resetConsentQueue: () => resetConsentQueue(),
                resetSuggestionStore: () => suggestionStore.reset(),
                resetExpensesStore: () => expensesSyncStore.reset(),
                clearKickCountDraft: () => clearDraft(),
                onComplete: () => {
                  // §3.3 success toast: seed LoginScreen's on-mount banner
                  // before resetting the stack so the message is ready when
                  // the screen mounts.  Uses the active locale via t().
                  setPendingLoginSuccessToast(t('reset.successToast'));
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'Login' }],
                  });
                },
              });
            }}
            onRequestNewLink={() => {
              // MI-5: 410 → clear token, navigate to ForgotPassword
              clearResetToken();
              navigation.reset({
                index: 0,
                routes: [{ name: 'ForgotPassword' }],
              });
            }}
          />
        )}
      </Stack.Screen>

      {/* Register (S2) */}
      <Stack.Screen
        name="Register"
        options={{ title: t('welcome.createAccount'), headerBackTitle: '' }}
      >
        {({ navigation }) => (
          <RegisterScreen
            apiBaseUrl={apiBaseUrl}
            onSuccess={(email) =>
              navigation.navigate('VerifyEmail', { email })
            }
            onSignIn={() => navigation.navigate('Login')}
          />
        )}
      </Stack.Screen>

      {/* VerifyEmail / Check inbox (S3) */}
      <Stack.Screen
        name="VerifyEmail"
        options={{ title: t('verify.navTitle'), headerBackVisible: false }}
      >
        {({ route, navigation }) => (
          <VerifyEmailScreen
            apiBaseUrl={apiBaseUrl}
            email={route.params.email}
            pendingToken={route.params.pendingToken}
            tokenStorage={tokenStorage}
            onVerified={() =>
              // S3: first-run consent before MainTabs (PDPA prod-gate)
              navigation.reset({ index: 0, routes: [{ name: 'Consent' }] })
            }
            onChangeEmail={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Register' }] })
            }
          />
        )}
      </Stack.Screen>

      {/* Consent — S3 first-run PDPA consent.
       * onContinue resets to MainTabs (Calendar tab is the initial route).
       */}
      <Stack.Screen
        name="Consent"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <ConsentScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onContinue={() =>
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
            }
          />
        )}
      </Stack.Screen>

      {/* MainTabs — BottomTabNavigator (5 tabs, v2).
       *
       * Wraps: Supplies, Expenses, Home (center, initial), Calendar, Medication.
       * HomeTabScreen handles profile GET, updates PregnancyProfileContext,
       * and dispatches to non-tab screens (BirthEvent, Settings, KickCount,
       * DoctorReport entry row, etc.).
       * ProfileSetup is a root-stack screen; when HomeTabScreen navigates to it
       * the tab bar is naturally suppressed (BottomTabNavigator is unmounted).
       *
       * headerShown: false — BottomTabNavigator manages its own tab bar;
       * HomeTabScreen renders its own top bar with ⚙ and [TH|EN] (v2 §3.2).
       */}
      <Stack.Screen
        name="MainTabs"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <BottomTabNavigator
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            navigation={navigation}
          />
        )}
      </Stack.Screen>

      {/* ProfileSetup — initial due-date / current-week entry (US-1).
       * Entry: CalendarTabScreen onNeedsProfile (GET 404).
       * Tab bar is suppressed while this screen is active (root-stack screen).
       * onSetupComplete resets to MainTabs (Calendar tab opens by default).
       */}
      <Stack.Screen
        name="ProfileSetup"
        options={{ title: t('profile.navTitle'), headerBackTitle: '' }}
      >
        {({ navigation }) => (
          <ProfileSetupScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onSetupComplete={() =>
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
            }
          />
        )}
      </Stack.Screen>

      {/* BirthEvent — records birth and transitions lifecycle to postpartum.
       *
       * Entry: T3 stage banner "ลูกคลอดแล้ว ›" in CalendarTabScreen.
       * Exit: resets stack to MainTabs; CalendarTabScreen reloads on focus → postpartum.
       */}
      <Stack.Screen
        name="BirthEvent"
        options={{ title: t('birth.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ route, navigation }) => (
          <BirthEventScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            profileVersion={route.params.profileVersion}
            onBirthRecorded={() =>
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
            }
            onCancel={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* AppointmentForm — add/edit ChecklistItem (category=appointment).
       * Stack-pushed over tabs from CalendarTabScreen.
       */}
      <Stack.Screen
        name="AppointmentForm"
        options={({ route }) => ({
          title: route.params?.itemId
            ? t('appointment.navTitleEdit')
            : t('appointment.navTitleNew'),
          headerBackTitle: t('general.back'),
        })}
      >
        {({ route, navigation }) => {
          const existingItem = route.params?.itemId
            ? calendarSyncStore.getChecklistItem(route.params.itemId) ?? undefined
            : undefined;
          const defaultCategory =
            (route.params?.defaultCategory as import('../sync/syncTypes').ChecklistItemCategory | undefined) ??
            'appointment';
          return (
            <AppointmentFormScreen
              existingItem={existingItem}
              defaultCategory={defaultCategory}
              tokenStorage={tokenStorage}
              apiBaseUrl={apiBaseUrl}
              lifecycle={snapshot?.lifecycle}
              onSave={() => navigation.goBack()}
              onCancel={() => navigation.goBack()}
            />
          );
        }}
      </Stack.Screen>

      {/* ReminderForm — add/edit Reminder (FLAG-4).
       * Stack-pushed over tabs from CalendarTabScreen.
       */}
      <Stack.Screen
        name="ReminderForm"
        options={({ route }) => ({
          title: route.params?.reminderId
            ? t('reminder.navTitleEdit')
            : t('reminder.navTitleNew'),
          headerBackTitle: t('general.back'),
        })}
      >
        {({ route, navigation }) => {
          const existingReminder = route.params?.reminderId
            ? calendarSyncStore.getReminder(route.params.reminderId) ?? undefined
            : undefined;
          return (
            <ReminderFormScreen
              existingReminder={existingReminder}
              tokenStorage={tokenStorage}
              apiBaseUrl={apiBaseUrl}
              lifecycle={snapshot?.lifecycle}
              onSave={() => navigation.goBack()}
              onCancel={() => navigation.goBack()}
            />
          );
        }}
      </Stack.Screen>

      {/* Settings — account/settings menu.
       * Entry: gear ⚙ in Home tab top bar (v2 §3.2 — moved from Calendar).
       * Reads profileSnapshot from PregnancyProfileContext for lifecycle-gated rows.
       */}
      <Stack.Screen
        name="Settings"
        options={{ title: t('settings.title'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <SettingsScreen
            tokenStorage={tokenStorage}
            onLogout={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })
            }
            onManageConsent={() => navigation.navigate('ManageConsents')}
            onCalendarSync={() => navigation.navigate('CalendarSyncSettings')}
            apiBaseUrl={apiBaseUrl}
            onSessionExpired={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })
            }
            profileLifecycle={snapshot?.lifecycle ?? null}
            onEditPregnancy={
              snapshot?.lifecycle === 'pregnant'
                ? () => navigation.navigate('ProfileEdit')
                : undefined
            }
          />
        )}
      </Stack.Screen>

      {/* ProfileEdit — edit-pregnancy-profile (AC-13 SD-5 teardown on 401). */}
      <Stack.Screen
        name="ProfileEdit"
        options={{ title: t('profile.editNavTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <ProfileEditScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            navigation={navigation}
            onEditComplete={() => navigation.goBack()}
            onSessionExpired={() => {
              void performLogout({
                clearTokens: () => tokenStorage.clear(),
                resetSupplyStore: () => supplySyncStore.reset(),
                resetKickCountStore: () => kickCountSyncStore.reset(),
                resetCalendarStore: () => calendarSyncStore.reset(),
                resetSelfLogStore: () => selfLogSyncStore.reset(),
                resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
                resetMedicationLogStore: () => medicationLogSyncStore.reset(),
                resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
                resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
                resetConsentStore: () => consentStore.reset(),
                resetConsentQueue: () => resetConsentQueue(),
                resetSuggestionStore: () => suggestionStore.reset(),
                resetExpensesStore: () => expensesSyncStore.reset(),
                clearKickCountDraft: () => clearDraft(),
                onComplete: () =>
                  navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
              });
            }}
          />
        )}
      </Stack.Screen>

      {/* LossConfirm — Screen B: pregnancy-loss two-step confirmation.
       *
       * Entry: ProfileEdit (Account ▸ Pregnancy) quiet entry link, shown ONLY
       * when lifecycle === 'pregnant' (INV-ENTRY-2). No push/deep-link ever
       * reaches this screen (LOSS-INV-9).
       *
       * On success (200 ended, or 409-already-ended): reset to MainTabs —
       * HomeTabScreen's own focus-triggered GET refreshes the snapshot to
       * lifecycle:'ended', which re-evaluates every loss-gated surface in
       * the same render cycle (§5.7/§12.1). Same convention as BirthEvent's
       * onBirthRecorded → reset(MainTabs).
       * "Go back" / benign-postpartum-terminal → goBack() (nothing recorded).
       * BLOCKER-2: network/5xx failure NEVER resets/records — the screen
       * itself shows a calm inline error and stays open (no false-success).
       */}
      <Stack.Screen
        name="LossConfirm"
        options={{ title: t('loss.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ route, navigation }) => (
          <LossConfirmScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            profileVersion={route.params.profileVersion}
            edd={snapshot?.edd ?? ''}
            onLossRecorded={() =>
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
            }
            onGoBack={() => navigation.goBack()}
            onSessionExpired={() => {
              void performLogout({
                clearTokens: () => tokenStorage.clear(),
                resetSupplyStore: () => supplySyncStore.reset(),
                resetKickCountStore: () => kickCountSyncStore.reset(),
                resetCalendarStore: () => calendarSyncStore.reset(),
                resetSelfLogStore: () => selfLogSyncStore.reset(),
                resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
                resetMedicationLogStore: () => medicationLogSyncStore.reset(),
                resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
                resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
                resetConsentStore: () => consentStore.reset(),
                resetConsentQueue: () => resetConsentQueue(),
                resetSuggestionStore: () => suggestionStore.reset(),
                resetExpensesStore: () => expensesSyncStore.reset(),
                clearKickCountDraft: () => clearDraft(),
                onComplete: () =>
                  navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
              });
            }}
            onGoToConsent={() => navigation.navigate('ManageConsents')}
          />
        )}
      </Stack.Screen>

      {/* ReopenConfirm — Screen C confirmation: reopen (correction).
       *
       * Entry: ProfileHubScreen quiet reopen entry, shown ONLY when
       * lifecycle === 'ended' (mobile-reviewer BLOCKER-1 fix — ProfileHub
       * reads the raw snapshot directly and renders regardless of
       * lifecycle, unlike ProfileEditScreen which is gated pregnant-only and
       * can never surface an 'ended' profile). No route params (SD-9) — the
       * screen GETs its own fresh profile + version on mount.
       *
       * On success: reset to MainTabs — HomeTabScreen's focus-triggered GET
       * refreshes the snapshot to lifecycle:'pregnant' (loss_date cleared,
       * S4), reverting every loss-gated surface immediately.
       */}
      <Stack.Screen
        name="ReopenConfirm"
        options={{ title: t('loss.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <ReopenConfirmScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onReopened={() =>
              navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
            }
            onGoBack={() => navigation.goBack()}
            onSessionExpired={() => {
              void performLogout({
                clearTokens: () => tokenStorage.clear(),
                resetSupplyStore: () => supplySyncStore.reset(),
                resetKickCountStore: () => kickCountSyncStore.reset(),
                resetCalendarStore: () => calendarSyncStore.reset(),
                resetSelfLogStore: () => selfLogSyncStore.reset(),
                resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
                resetMedicationLogStore: () => medicationLogSyncStore.reset(),
                resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
                resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
                resetConsentStore: () => consentStore.reset(),
                resetConsentQueue: () => resetConsentQueue(),
                resetSuggestionStore: () => suggestionStore.reset(),
                resetExpensesStore: () => expensesSyncStore.reset(),
                clearKickCountDraft: () => clearDraft(),
                onComplete: () =>
                  navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
              });
            }}
          />
        )}
      </Stack.Screen>

      {/* ProfileInfoEdit — edit mother first/last name + baby name (lifecycle-agnostic).
       * Entry: ProfileHubScreen > "แก้ไขชื่อ / ข้อมูลส่วนตัว" row.
       * AC-13 / SD-5: GET 401 and PUT 401 run full performLogout teardown.
       * SD-9: no name/health data in route params (screen GETs fresh on mount).
       */}
      <Stack.Screen
        name="ProfileInfoEdit"
        options={{ title: t('profileInfo.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <ProfileInfoEditScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onSaveComplete={() => navigation.goBack()}
            onSessionExpired={() => {
              void performLogout({
                clearTokens: () => tokenStorage.clear(),
                resetSupplyStore: () => supplySyncStore.reset(),
                resetKickCountStore: () => kickCountSyncStore.reset(),
                resetCalendarStore: () => calendarSyncStore.reset(),
                resetSelfLogStore: () => selfLogSyncStore.reset(),
                resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
                resetMedicationLogStore: () => medicationLogSyncStore.reset(),
                resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
                resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
                resetConsentStore: () => consentStore.reset(),
                resetConsentQueue: () => resetConsentQueue(),
                resetSuggestionStore: () => suggestionStore.reset(),
                resetExpensesStore: () => expensesSyncStore.reset(),
                clearKickCountDraft: () => clearDraft(),
                onComplete: () =>
                  navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
              });
            }}
          />
        )}
      </Stack.Screen>

      {/* PregnancySummary — read-only pregnancy recap (trimester + delivery).
       *
       * Entry: ProfileHubScreen > "สรุปการตั้งครรภ์" row (lifecycle-agnostic).
       * SD-9: params = undefined — PregnancySummaryWrapper performs GET on mount
       *   and passes decoded health data to PregnancySummaryScreen (NOT route params).
       * SD-5: GET 401 → performLogout teardown → Welcome.
       * Wiring/test-only: disclaimer/4-conditions/K-8/computation are approved,
       *   unchanged. Only the route registration and GET-on-mount wiring is new.
       */}
      <Stack.Screen
        name="PregnancySummary"
        options={{ title: t('pregnancySummary.navTitle'), headerShown: false }}
      >
        {({ navigation: stackNav }) => (
          <PregnancySummaryWrapper
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            lifecycle={snapshot?.lifecycle}
            onBack={() => stackNav.goBack()}
            onSetEdd={() =>
              stackNav.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] })
            }
            onSessionExpired={() => {
              void performLogout({
                clearTokens: () => tokenStorage.clear(),
                resetSupplyStore: () => supplySyncStore.reset(),
                resetKickCountStore: () => kickCountSyncStore.reset(),
                resetCalendarStore: () => calendarSyncStore.reset(),
                resetSelfLogStore: () => selfLogSyncStore.reset(),
                resetMedicationPlanStore: () => medicationPlanSyncStore.reset(),
                resetMedicationLogStore: () => medicationLogSyncStore.reset(),
                resetConsumptionMappingStore: () => consumptionMappingStore.reset(),
                resetStockDecrementMarkerStore: () => stockDecrementMarkerStore.reset(),
                resetConsentStore: () => consentStore.reset(),
                resetConsentQueue: () => resetConsentQueue(),
                resetSuggestionStore: () => suggestionStore.reset(),
                resetExpensesStore: () => expensesSyncStore.reset(),
                clearKickCountDraft: () => clearDraft(),
                onComplete: () =>
                  stackNav.reset({ index: 0, routes: [{ name: 'Welcome' }] }),
              });
            }}
          />
        )}
      </Stack.Screen>

      {/* ManageConsents — S8 PDPA ม.19 withdrawal.
       * Entry: Settings > Manage Permissions.
       */}
      <Stack.Screen
        name="ManageConsents"
        options={{ title: t('consent.manage.title'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <ManageConsentsScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onBack={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* ── Calendar Sync ─────────────────────────────────────────────────────────
       *
       * Three routes for Approach A device-calendar sync feature:
       *
       *   CalendarSyncSettings  (CS-4): Hub screen — toggle, status, privacy row, disable.
       *     Entry: Settings > "ซิงก์ปฏิทินในเครื่อง" row.
       *     SD-9: params = undefined (no health data in route params).
       *
       *   CalendarSyncConsent   (CS-1): Explainer + consent sheet (modal).
       *     Can also be shown as an internal Modal from CalendarSyncSettingsScreen.
       *     SD-9: params = undefined.
       *
       *   CalendarSyncPrivacyLevel (CS-5): Privacy-level picker (generic vs descriptive).
       *     Entry: CalendarSyncSettings > "ระดับความเป็นส่วนตัว" row.
       *     SD-9: params = undefined.
       *
       * Security: ZERO health data in any of these route params (SD-9).
       * Native-only: expo-calendar writes require a dev/EAS build (not Expo Go).
       * All logic tests run against a mock gateway (src/deviceCalendar/__tests__/).
       */}

      {/* CS-4 — Calendar Sync Settings hub
       *
       * BLOCKER 1 fix: pass real state + handlers from deviceCalendarSingleton.
       *   featureEnabled / privacyLevel / consentGranted / osPermissionGranted
       *     come from calSyncState (refreshed via refreshCalSyncState after each op).
       *   onGrantConsent → grantConsent() + update consent + enableFeature() + backfill
       *   onToggleOn     → enableFeature() + backfill (consent already granted)
       *   onDisableFeature → disableAndWithdraw(action, version)
       *
       * The inline consent sheet (CalendarSyncConsentSheet rendered inside the screen)
       * uses these same handlers, so the explainer-before-prompt order is respected:
       *   [1] Mother taps toggle → sheet appears (the explainer)
       *   [2] Mother taps Grant → handleCalGrantConsent() → grantConsent() (no OS prompt)
       *   [3] → enableFeature() → requestPermission() (OS prompt fires HERE)
       *
       * SD-9: params = undefined (no health data in route params).
       */}
      <Stack.Screen
        name="CalendarSyncSettings"
        options={{ title: 'ซิงก์ปฏิทินในเครื่อง', headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <CalendarSyncSettingsScreen
            onNavigateToPrivacyLevel={() => navigation.navigate('CalendarSyncPrivacyLevel')}
            onBack={() => navigation.goBack()}
            featureEnabled={calSyncState.featureEnabled}
            privacyLevel={calSyncState.privacyLevel}
            consentGranted={calSyncState.consentGranted}
            osPermissionGranted={calSyncState.osPermissionGranted}
            onGrantConsent={handleCalGrantConsent}
            onToggleOn={handleCalToggleOn}
            onDisableFeature={handleCalDisableFeature}
          />
        )}
      </Stack.Screen>

      {/* CS-1 — Calendar Sync Consent sheet (standalone route; also shown inline as Modal)
       *
       * BLOCKER 1 fix: onGrant was a pure no-op; now wired to the real consent flow.
       * Standalone route used when the consent sheet is pushed directly (not inline).
       * SD-9: params = undefined.
       */}
      <Stack.Screen
        name="CalendarSyncConsent"
        options={{ headerShown: false, presentation: 'transparentModal' }}
      >
        {({ navigation }) => (
          <CalendarSyncConsentSheet
            visible
            onGrant={async () => {
              await handleCalGrantConsent();
              navigation.goBack();
            }}
            onDecline={() => { navigation.goBack(); }}
          />
        )}
      </Stack.Screen>

      {/* CS-5 — Calendar Sync Privacy Level picker
       *
       * BLOCKER 1 fix: was hardcoded currentLevel="generic" with no-op onLevelSelected.
       * Now passes the real current privacy level from calSyncState and wires
       * onLevelSelected → changePrivacyLevel() → full re-mask sweep (AC-5.2).
       * SD-9: params = undefined.
       */}
      <Stack.Screen
        name="CalendarSyncPrivacyLevel"
        options={{ title: 'ระดับความเป็นส่วนตัว', headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <CalendarSyncPrivacyLevelScreen
            currentLevel={calSyncState.privacyLevel}
            onLevelSelected={async (level) => {
              await handleCalPrivacyLevelSelected(level);
              navigation.goBack();
            }}
            onBack={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* Suggestions — full stage-scoped suggestion list.
       * Entry: SuggestionBanner "View all" in HomeTabScreen (v2).
       * Props derived from profileSnapshot (PregnancyProfileContext).
       *
       * FIX2 — three previously missing props:
       *   edd: from the profile snapshot (needed for ANC cadence offerable §1.3 item 1)
       *   upcomingApptInWindow: computed from calendarSyncStore at render time
       *     (§1.3 item 4 — "already has an appointment" suppression guard)
       *   onAncStart: opens AncAppointmentForm with the prefill payload; the prefill
       *     is held in ancPrefillRef (NOT in route params — PDPA SD-9).
       */}
      <Stack.Screen
        name="Suggestions"
        options={{ headerShown: false }}
      >
        {({ navigation }) => {
          // upcomingApptInWindow: computed from calendarSyncStore at render time
          // so it reflects any appointments created since the last render.
          const upcomingApptInWindow = hasUpcomingAncApptInWindow(
            kickProps.edd || null,
            kickProps.gestationalWeek,
            calendarSyncStore.getActiveChecklistItems(),
          );

          return (
            <SuggestionFlowScreen
              lifecycle={kickProps.lifecycle}
              stage={
                kickProps.lifecycle === 'pregnant'
                  ? (kickProps.gestationalWeek >= 28
                      ? 'T3'
                      : kickProps.gestationalWeek >= 14
                        ? 'T2'
                        : 'T1')
                  : null
              }
              gestationalWeek={kickProps.gestationalWeek}
              edd={kickProps.edd || null}
              upcomingApptInWindow={upcomingApptInWindow}
              onBack={() => navigation.goBack()}
              onKickCount={() => navigation.navigate('KickCountHome')}
              onSupplies={() => navigation.navigate('MainTabs', { screen: 'Supplies' })}
              onCalendar={() => navigation.navigate('MainTabs', { screen: 'Calendar' })}
              onAncStart={(prefill) => {
                // PDPA SD-9: store prefill in ref (not route params) then navigate.
                // The ref is set synchronously before navigate() so AncAppointmentForm
                // always reads a fresh, non-null prefill on mount.
                ancPrefillRef.current = prefill;
                navigation.navigate('AncAppointmentForm');
              }}
            />
          );
        }}
      </Stack.Screen>

      {/* AncAppointmentForm — AppointmentFormScreen pre-filled from ANC suggestion.
       *
       * Entry: onAncStart callback in SuggestionFlowScreen.
       * Prefill is provided via ancPrefillRef (PDPA SD-9 — no health data in params).
       * The form opens in CREATE mode (isEdit=false, no existingItem).
       * INV-A4: nothing is written until the mother taps Save.
       * Cancel/back: 0 ChecklistItem / 0 Reminder enqueued.
       */}
      <Stack.Screen
        name="AncAppointmentForm"
        options={{ title: t('appointment.navTitleNew'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <AppointmentFormScreen
            prefill={ancPrefillRef.current ?? undefined}
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            lifecycle={snapshot?.lifecycle}
            onSave={() => navigation.goBack()}
            onCancel={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* AutoDecrementSettings — Screen 1: configure activity→supply-item mappings.
       * Entry: SuppliesTab "ตั้งค่าตัดสต็อกอัตโนมัติ ›" button.
       * SD-9: no health data in route params (params = undefined).
       *
       * Bug #2 fix: onNavigateConsent + onNavigateItemPicker were previously
       * omitted here, which silently made the missing-consent advisory CTA and
       * the "Link an item" affordance permanent no-ops — no mapping could ever
       * be created, leaving the auto-decrement engine inert.
       */}
      <Stack.Screen
        name="AutoDecrementSettings"
        options={{ headerShown: false }}
      >
        {({ navigation: nav }) => (
          <AutoDecrementSettingsScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onBack={() => nav.goBack()}
            onNavigateSubUnitSetup={(supplyItemId) =>
              // SD-9: only the supply item ID goes in route params — no health data
              nav.navigate('SubUnitSetup', { supplyItemId })
            }
            onNavigateItemPicker={(activityType) =>
              // SD-9: activityType is a closed 3-value enum, not health data
              nav.navigate('SupplyItemPicker', { activityType })
            }
            onNavigateConsent={() => nav.navigate('ManageConsents')}
          />
        )}
      </Stack.Screen>

      {/* SubUnitSetup — Screen 2: configure usesPerContainer for a supply item.
       * Entry: AutoDecrementSettings D-4 advisory deep-link.
       * SD-9: supplyItemId param is a UUID only — screen fetches item locally.
       */}
      <Stack.Screen
        name="SubUnitSetup"
        options={{ headerShown: false }}
      >
        {({ route, navigation: nav }) => (
          <SubUnitSetupScreen
            supplyItemId={route.params.supplyItemId}
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onBack={() => nav.goBack()}
          />
        )}
      </Stack.Screen>

      {/* SupplyItemPicker — "Link an item" destination (Bug #2 fix).
       * Entry: AutoDecrementSettings "+ เชื่อมต่อของใช้" affordance per activity section.
       * SD-9: activityType is a closed enum, not health data. No supply data in params.
       */}
      <Stack.Screen
        name="SupplyItemPicker"
        options={{ headerShown: false }}
      >
        {({ route, navigation: nav }) => (
          <SupplyItemPickerScreen
            activityType={route.params.activityType}
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onBack={() => nav.goBack()}
            onPicked={() => nav.goBack()}
          />
        )}
      </Stack.Screen>

      {/* FeedingLog — Screen 3: feeding-log surface.
       * Entry: Supplies tab "บันทึกการให้นม ›" button (onFeedingLog prop).
       * formula kind triggers T-F auto-stock-decrement. No route params (SD-9).
       * INV-ASD-8: usesRemainingInOpenContainer never in params or session record.
       * FW-1: formula copy = verbatim item name + integers + neutral verbs only.
       */}
      <Stack.Screen
        name="FeedingLog"
        options={{ headerShown: false }}
      >
        {({ navigation: nav }) => (
          <FeedingLogScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onBack={() => nav.goBack()}
            onNavigateConsent={() => nav.navigate('ManageConsents')}
          />
        )}
      </Stack.Screen>

      {/* Capture — Quick Capture / Self-log form.
       * Stack-pushed over tabs from CalendarTabScreen day-detail or Medication tab.
       */}
      <Stack.Screen
        name="Capture"
        options={{ headerShown: false }}
      >
        {() => (
          <CaptureScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Stack.Screen>

      {/* DoctorReport — root-stack screen hosting DoctorPdfScreen (v2 §8A).
       *
       * Entry: HomeTab "รายงานสำหรับแพทย์ ›" entry row (onDoctorReport callback).
       * Replaces the former Report tab (OQ-NAV-4).
       * onBack = navigation.goBack() (native back to Home tab).
       *
       * §report-edd-guard: we only render DoctorPdfScreen when the snapshot exists
       * AND the EDD is a real date (not the '2999-12-31' sentinel that would be
       * injected via kickProps fallback when snapshot === null). If the snapshot is
       * null or the EDD is the sentinel, show a loading placeholder rather than
       * passing a bogus date to the PDF assembler.
       *
       * In practice, this guard is rarely triggered: HomeTabScreen's onDoctorReport
       * callback is only callable from the rendered DoctorReportRow, which is only
       * shown after loadProfile completes with a real profile. But defensive guard
       * here covers deep-link and dev edge cases.
       */}
      <Stack.Screen
        name="DoctorReport"
        options={DOCTOR_REPORT_ROUTE_OPTIONS}
      >
        {({ navigation: stackNav }) => {
          // §report-edd-guard
          const edd = snapshot?.edd ?? null;
          const isSentinel = edd === '2999-12-31';
          const isReady = snapshot !== null && edd !== null && !isSentinel;

          if (!isReady) {
            // Snapshot not yet populated or sentinel EDD — show placeholder.
            return (
              <View style={doctorReportGuardStyles.container}>
                <Text style={doctorReportGuardStyles.text}>
                  {t('home.loading')}
                </Text>
              </View>
            );
          }

          return (
            <DoctorPdfScreen
              tokenStorage={tokenStorage}
              apiBaseUrl={apiBaseUrl}
              profile={{
                edd: snapshot.edd,
                gestationalWeek: snapshot.gestationalWeek,
                lifecycle: snapshot.lifecycle,
              }}
              onBack={() => stackNav.goBack()}
            />
          );
        }}
      </Stack.Screen>

      {/* ── Kick Count — stack-pushed over tabs ────────────────────────────────
       *
       * Props derived from PregnancyProfileContext (kickProps).
       * Security: no health data in route params (K-8 PDPA SD-9).
       */}

      {/* SC-K0: KickCount entry.
       * GAP-2 (B3): lifecycle is passed as snapshot?.lifecycle (raw from context,
       * undefined when null) NOT kickProps.lifecycle (which defaults 'pregnant' when null).
       * KickCountHomeScreen accepts Lifecycle | undefined — undefined → loading/neutral
       * state, never the 'pregnant' default that would mask a real loss on cold-start.
       */}
      <Stack.Screen
        name="KickCountHome"
        options={{ title: t('kick.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <KickCountHomeScreen
            gestationalWeek={kickProps.gestationalWeek}
            lifecycle={snapshot?.lifecycle}
            generalHealthConsented={kickProps.generalHealthConsented}
            onRequestConsent={() => navigation.navigate('Consent')}
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Stack.Screen>

      {/* SC-K1: Active counting screen.
       * headerShown was previously false; native header now enabled (kick.navTitle)
       * so Counting has exactly ONE header matching the History/Detail pattern.
       * The header is minimal/non-intrusive — it sits above the timer+count,
       * does not crowd the prominent count number or elapsed timer.
       */}
      <Stack.Screen
        name="KickCountCounting"
        options={{ title: t('kick.navTitle'), headerBackTitle: t('general.back') }}
      >
        {() => (
          <KickCountCountingScreen
            edd={kickProps.edd}
            todayCivil={kickProps.todayCivil}
            generalHealthConsented={kickProps.generalHealthConsented}
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Stack.Screen>

      {/* SC-K3: Post-finalize summary.
       * Title changed from kick.summaryHeadline to kick.navTitle for consistency:
       * all three entry-group screens (Home, Counting, Summary) now share the same
       * header title "นับลูกดิ้น" via kick.navTitle — matching History/Detail pattern.
       */}
      <Stack.Screen
        name="KickCountSummary"
        component={KickCountSummaryScreen}
        options={{ title: t('kick.navTitle'), headerBackTitle: t('general.back') }}
      />

      {/* SC-K4: History list.
       * Entry: from KickCountHome (pregnant) or KickCountSummary (all lifecycles).
       * Note: postpartum direct-entry link in HomeTabScreen was removed per UX change.
       */}
      <Stack.Screen
        name="KickCountHistory"
        options={{ title: t('kick.historyNavTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <KickCountHistoryScreen
            gestationalWeek={kickProps.gestationalWeek}
            lifecycle={kickProps.lifecycle}
            generalHealthConsented={kickProps.generalHealthConsented}
            onRequestConsent={() => navigation.navigate('Consent')}
          />
        )}
      </Stack.Screen>

      {/* SC-K5: Session detail */}
      <Stack.Screen
        name="KickCountDetail"
        component={KickCountDetailScreen}
        options={{ title: t('kick.detailNavTitle'), headerBackTitle: t('general.back') }}
      />
    </Stack.Navigator>
  );
}

// ─── §report-edd-guard loading placeholder styles ─────────────────────────────

const doctorReportGuardStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBF6F1',
  },
  text: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#94818A',
  },
});

// ─── Public export ────────────────────────────────────────────────────────────

export function RootNavigator({ tokenStorage, apiBaseUrl }: RootNavigatorProps): React.JSX.Element {
  return (
    <PregnancyProfileProvider>
      <StackNavigator tokenStorage={tokenStorage} apiBaseUrl={apiBaseUrl} />
    </PregnancyProfileProvider>
  );
}
