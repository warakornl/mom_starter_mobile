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

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import type { TokenStorage } from '../auth/tokenStorage';
import { localCivilToday } from '../pregnancy/gestationalAge';
import { PregnancyProfileProvider, useProfileSnapshot } from '../pregnancy/PregnancyProfileContext';

import { WelcomeScreen } from '../screens/WelcomeScreen';
import { LoginScreen } from '../auth/LoginScreen';
import { RegisterScreen } from '../auth/RegisterScreen';
import { VerifyEmailScreen } from '../auth/VerifyEmailScreen';
import { ProfileSetupScreen } from '../pregnancy/ProfileSetupScreen';
import { ProfileEditScreen } from '../pregnancy/ProfileEditScreen';
import { BirthEventScreen } from '../pregnancy/BirthEventScreen';
import { AppointmentFormScreen } from '../calendar/AppointmentFormScreen';
import { ReminderFormScreen } from '../calendar/ReminderFormScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { KickCountHomeScreen } from '../kickCount/KickCountHomeScreen';
import { KickCountCountingScreen } from '../kickCount/KickCountCountingScreen';
import { KickCountSummaryScreen } from '../kickCount/KickCountSummaryScreen';
import { KickCountHistoryScreen } from '../kickCount/KickCountHistoryScreen';
import { KickCountDetailScreen } from '../kickCount/KickCountDetailScreen';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { ConsentScreen } from '../screens/ConsentScreen';
import { ManageConsentsScreen } from '../screens/ManageConsentsScreen';
import { SuggestionFlowScreen } from '../suggestion/SuggestionFlowScreen';
import { CaptureScreen } from '../capture/CaptureScreen';
import { DoctorPdfScreen } from '../pdfReport/DoctorPdfScreen';
import { BottomTabNavigator } from './BottomTabNavigator';
import { useT } from '../i18n/LanguageContext';

// ── Logout deps for SD-5 teardown (used by ProfileEditScreen) ─────────────────
import { performLogout } from '../auth/performLogout';
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

const Stack = createNativeStackNavigator<RootStackParamList>();

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
            onForgotPassword={() => {
              // TODO: navigate('ForgotPassword') — carry-forward (S5 not yet built)
            }}
            onCreateAccount={() => navigation.navigate('Register')}
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

      {/* Suggestions — full stage-scoped suggestion list.
       * Entry: SuggestionBanner "View all" in HomeTabScreen (v2).
       * Props derived from profileSnapshot (PregnancyProfileContext).
       */}
      <Stack.Screen
        name="Suggestions"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
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
            onBack={() => navigation.goBack()}
            onKickCount={() => navigation.navigate('KickCountHome')}
            onSupplies={() => navigation.navigate('MainTabs', { screen: 'Supplies' })}
            onCalendar={() => navigation.navigate('MainTabs', { screen: 'Calendar' })}
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
        options={{ title: t('pdf.screen.builderTitle'), headerBackTitle: t('general.back') }}
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

      {/* SC-K0: KickCount entry */}
      <Stack.Screen
        name="KickCountHome"
        options={{ title: t('kick.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <KickCountHomeScreen
            gestationalWeek={kickProps.gestationalWeek}
            lifecycle={kickProps.lifecycle}
            generalHealthConsented={kickProps.generalHealthConsented}
            onRequestConsent={() => navigation.navigate('Consent')}
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Stack.Screen>

      {/* SC-K1: Active counting screen */}
      <Stack.Screen
        name="KickCountCounting"
        options={{ headerShown: false }}
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

      {/* SC-K3: Post-finalize summary */}
      <Stack.Screen
        name="KickCountSummary"
        component={KickCountSummaryScreen}
        options={{ title: t('kick.summaryHeadline'), headerBackTitle: t('general.back') }}
      />

      {/* SC-K4: History list.
       * Entry (postpartum): quiet history link in HomeTabScreen (v2 §4.3, direct entry).
       * Entry (pregnant): from KickCountHome.
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
