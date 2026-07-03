/**
 * RootNavigator — root native-stack navigator.
 *
 * Route map:
 *   Welcome → Login | Register
 *   Login → Home (on success) | Register (create account link)
 *   Register → VerifyEmail (on 202) | Login (sign-in link)
 *   VerifyEmail → Consent (on verify success) | Register (change email)
 *   Consent → Home (on continue — limited mode or full mode)
 *   Home — checks for PregnancyProfile on mount:
 *     → ProfileSetup (if GET /v1/pregnancy-profile returns 404)
 *     → stays on Home (if profile exists — pregnant or postpartum)
 *   Home (T3 lifecycle=pregnant) — "ลูกคลอดแล้ว" banner CTA:
 *     → BirthEvent (profile version passed as route param)
 *   ProfileSetup — initial due-date / current-week entry:
 *     → Home (on PUT success; resets stack)
 *   BirthEvent — records POST /v1/pregnancy-profile/birth-event:
 *     → Home (on success; resets stack; Home reloads and switches to postpartum)
 *
 * Design decisions:
 * - Auth screens keep their callback-based prop API (onSuccess, onSignIn, etc.)
 *   and are wired to navigation via render-prop children inside Stack.Screen.
 *   This decouples screen components from react-navigation and keeps them
 *   testable without a navigation environment.
 * - Login and VerifyEmail success use `navigation.reset` to clear the auth stack
 *   so the user cannot "back" into the sign-in screen after logging in.
 * - HomeScreen receives `onBirthEvent(profileVersion)` which navigates to the
 *   BirthEvent screen with the version as a route param (for If-Match header).
 * - BirthEventScreen receives `onBirthRecorded` which resets to Home; HomeScreen
 *   then reloads on foreground and switches to postpartum mode.
 *
 * i18n:
 * - Navigator header titles sourced from useT() so they update on locale change.
 * - The `locale` prop on auth screens has been removed (deprecated; locale is
 *   now read from LanguageContext inside each screen via useT()).
 *
 * Carry-forward:
 * - ForgotPassword screen (onForgotPassword is currently a no-op)
 * - Expo Linking deep-link for momstarter://verify?token= → VerifyEmailScreen
 * - ManageConsents screen (S8) is registered; Settings routes to it for ม.19 withdrawal
 */

import React, { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import type { TokenStorage } from '../auth/tokenStorage';
import type { ProfileSnapshot } from '../pregnancy/PregnancyProfileContext';
import { localCivilToday } from '../pregnancy/gestationalAge';

import { WelcomeScreen } from '../screens/WelcomeScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../auth/LoginScreen';
import { RegisterScreen } from '../auth/RegisterScreen';
import { VerifyEmailScreen } from '../auth/VerifyEmailScreen';
import { ProfileSetupScreen } from '../pregnancy/ProfileSetupScreen';
import { BirthEventScreen } from '../pregnancy/BirthEventScreen';
import { SuppliesScreen } from '../supplies/SuppliesScreen';
import { ExpensesScreen } from '../expenses/ExpensesScreen';
import { CalendarScreen } from '../calendar/CalendarScreen';
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
import { DoctorPdfScreen } from '../pdfReport/DoctorPdfScreen';
import { CaptureScreen } from '../capture/CaptureScreen';
import { buildAddCaptureParams } from '../calendar/calendarAddCaptureHandler';
import { MedicationPlanListScreen } from '../medication/MedicationPlanListScreen';
import { useT } from '../i18n/LanguageContext';

// ── Logout deps for the session-expiry / no-token auto-logout path ───────────
// RootNavigator wires these so that HomeScreen.loadProfile → no-token → onLogout()
// routes through performLogout, clearing ALL health stores (PDPA 1.1 / SD-5).
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

export function RootNavigator({ tokenStorage, apiBaseUrl }: RootNavigatorProps): React.JSX.Element {
  const { t } = useT();

  // B-1: Profile snapshot — populated by HomeScreen via onProfileLoaded.
  // Used to pass gestationalWeek/edd/lifecycle/consent to KickCount screens
  // without serializing health data through route params.
  const [profileSnapshot, setProfileSnapshot] = useState<ProfileSnapshot | null>(null);

  // Derived props for KickCount screens (safe defaults before profile loads).
  const kickProps: ProfileSnapshot = profileSnapshot ?? {
    gestationalWeek: 0,
    edd: '',
    todayCivil: localCivilToday(),
    lifecycle: 'pregnant',
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
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
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
              // S3: first-run consent before Home (PDPA prod-gate)
              navigation.reset({ index: 0, routes: [{ name: 'Consent' }] })
            }
            onChangeEmail={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Register' }] })
            }
          />
        )}
      </Stack.Screen>

      {/* Consent — S3 first-run PDPA consent (general_health + cloud_storage).
       * Entry: VerifyEmail onVerified (new registrations only).
       * Returning users manage consents via Settings > ManageConsentsScreen (S8).
       * onContinue resets to Home regardless of what the user chose;
       *   generalHealthGranted=false → limited mode (gate logic in HomeScreen).
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
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
            }
          />
        )}
      </Stack.Screen>

      {/* Home — dashboard
       *
       * Checks for PregnancyProfile on mount:
       *   GET 404 → calls onNeedsProfile → navigate to ProfileSetup
       *   GET 200, lifecycle=pregnant   → gestational-age dashboard + T3 birth CTA
       *   GET 200, lifecycle=postpartum → baby-age dashboard (sage/green, postpartum)
       *
       * B-1: onProfileLoaded updates profileSnapshot state so KickCount screens
       *   receive the correct gestationalWeek/edd/lifecycle/consent props.
       * B-1: onKickCount navigates to KickCountHome (wk32 gate enforced in HomeScreen).
       */}
      <Stack.Screen
        name="Home"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <HomeScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onLogout={() => {
              // Route through performLogout so ALL health stores are reset on
              // session-expiry / no-token exit — not just on explicit logout
              // in SettingsScreen. clearTokens is safe to call even when the
              // token is already gone: it's wrapped in try/catch inside
              // performLogout (PDPA 1.1 / SD-5 cross-account-leak guard).
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
            onNeedsProfile={() =>
              navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] })
            }
            onBirthEvent={(profileVersion) =>
              navigation.navigate('BirthEvent', { profileVersion })
            }
            onSupplies={() => navigation.navigate('Supplies')}
            onExpenses={() => navigation.navigate('Expenses')}
            onCalendar={() => navigation.navigate('Calendar')}
            onMedication={() => navigation.navigate('MedicationPlans')}
            onKickCount={() => navigation.navigate('KickCountHome')}
            onSettings={() => navigation.navigate('Settings')}
            onSuggestions={() => navigation.navigate('Suggestions')}
            onDoctorPdf={() => navigation.navigate('DoctorPdf')}
            onProfileLoaded={(snapshot) => setProfileSnapshot(snapshot)}
          />
        )}
      </Stack.Screen>

      {/* ProfileSetup — initial due-date / current-week entry (US-1) */}
      <Stack.Screen
        name="ProfileSetup"
        options={{ title: t('profile.navTitle'), headerBackTitle: '' }}
      >
        {({ navigation }) => (
          <ProfileSetupScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onSetupComplete={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
            }
          />
        )}
      </Stack.Screen>

      {/* BirthEvent — records birth and transitions lifecycle to postpartum
       *
       * Entry: T3 stage banner "ลูกคลอดแล้ว ›" in HomeScreen
       * Exit: resets stack to Home; HomeScreen reloads on foreground and
       *       switches to postpartum mode (lifecycle=postpartum from GET profile).
       *
       * Birth CTA placement (pregnancy-profile-ui §4.1):
       *   Reached from the stage banner (T3 only) and Account ▸ Pregnancy.
       *   Never a prominent card on the calendar surface.
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
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
            }
            onCancel={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* Supplies — offline-first supply checklist (sync engine slice 1)
       *
       * Entry: shortcut button on HomeScreen ("รายการเตรียมคลอด ›").
       * The SyncStore is module-level in SuppliesScreen so data persists
       * across in-session re-mounts; a full app restart triggers a fresh pull.
       */}
      <Stack.Screen
        name="Supplies"
        options={{ title: t('supplies.navTitle'), headerBackTitle: t('general.back') }}
      >
        {() => (
          <SuppliesScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Stack.Screen>

      {/* Expenses — offline-first monthly expense ledger (expenses-feature)
       *
       * Entry: shortcut button on HomeScreen ("ค่าใช้จ่าย ›").
       * ExpensesSyncStore is module-level; data persists across in-session re-mounts.
       * amount stored/synced as satang integer; displayed as ฿ with 2 decimals.
       */}
      <Stack.Screen
        name="Expenses"
        options={{ title: t('expenses.navTitle'), headerBackTitle: t('general.back') }}
      >
        {() => (
          <ExpensesScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
          />
        )}
      </Stack.Screen>

      {/* Calendar — month/agenda (calendar + reminder occurrences + appointments)
       *
       * Entry: "ดูทั้งหมด" / calendar button on HomeScreen.
       * CalendarScreen receives navigation callbacks for add/edit forms.
       * tokenStorage + apiBaseUrl enable sync push/pull for calendar data.
       */}
      <Stack.Screen
        name="Calendar"
        options={{ title: t('calendar.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <CalendarScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onAddAppointment={() =>
              navigation.navigate('AppointmentForm', {})
            }
            onEditAppointment={(itemId: string) =>
              navigation.navigate('AppointmentForm', { itemId })
            }
            onAddReminder={() =>
              navigation.navigate('ReminderForm', {})
            }
            onEditReminder={(reminderId: string) =>
              navigation.navigate('ReminderForm', { reminderId })
            }
            onAddCapture={(loggedAtDate: string) =>
              navigation.navigate('Capture', buildAddCaptureParams(loggedAtDate))
            }
          />
        )}
      </Stack.Screen>

      {/* AppointmentForm — add/edit ChecklistItem (category=appointment)
       *
       * Entry: CalendarScreen FAB or tapping an existing appointment.
       * itemId present → edit mode (looks up calendarSyncStore.getChecklistItem).
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

      {/* ReminderForm — add/edit Reminder with recurrenceRule (FLAG-4)
       *
       * Entry: CalendarScreen FAB or tapping an existing reminder.
       * reminderId present → edit mode (looks up calendarSyncStore.getReminder).
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

      {/* Settings — account/settings menu; home for logout (two levels deep).
       * Entry: gear ⚙ in the Home header. Stock header provides the back button.
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
          />
        )}
      </Stack.Screen>

      {/* ManageConsents — S8 Manage-Consents screen (PDPA ม.19 withdrawal).
       * Entry: Settings > Manage Permissions (returning users).
       * Lists all 6 consent types with toggle grant/withdraw.
       * Withdrawal confirmation sheet shown for 4 of 6 types (§3.3.2).
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

      {/* Suggestions — stage-scoped suggestion list (suggestion-flow-ui.md)
       *
       * Entry: SuggestionBanner "View all" link on HomeScreen.
       * Props: gestationalWeek/stage/lifecycle from profileSnapshot.
       * Actions: Start routes to kick count / supplies / calendar;
       *          Snooze + Dismiss update the local suggestionStore.
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
            onSupplies={() => navigation.navigate('Supplies')}
            onCalendar={() => navigation.navigate('Calendar')}
          />
        )}
      </Stack.Screen>

      {/* DoctorPdf — Builder→Preview→Share screen for the doctor-summary PDF.
       *
       * Entry: "รายงานสำหรับแพทย์" shortcut button on HomeScreen.
       * profile prop derives from profileSnapshot (HomeScreen.onProfileLoaded).
       * No health data in route params (PDPA SD-9).
       * Spec: pdf-doctor-ui.md §1–§5.
       */}
      <Stack.Screen
        name="DoctorPdf"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <DoctorPdfScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            profile={{
              edd: kickProps.edd || '2999-12-31',
              gestationalWeek: kickProps.gestationalWeek,
              lifecycle: kickProps.lifecycle,
            }}
            onBack={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      {/* Capture — Quick Capture / Self-log form (capture-ui.md).
       *
       * Entry: Day-Detail "Add" / Home shortcut / specific-context reminder.
       * metricType param hides the type control (pre-set context).
       * No health data in route params (PDPA SD-9).
       * header: hidden (CaptureScreen renders its own header with Close + title).
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

      {/* MedicationPlans — Medication Plan Management (medication-plan-ui.md).
       *
       * Entry: bottom-nav tab at the same level as Calendar, Expenses, Supplies.
       *   Wired via HomeScreen.onMedication (shortcut at the same tier as the
       *   others) pending a future TabNavigator refactor.
       * general_health gates Save → warm consent-nudge → persist on Grant.
       * cloud_storage absent → local-save + "not synced" toast.
       * No health data in route params (PDPA SD-9).
       */}
      <Stack.Screen
        name="MedicationPlans"
        options={{ title: t('medication.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <MedicationPlanListScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onManageConsents={() => navigation.navigate('ManageConsents')}
          />
        )}
      </Stack.Screen>

      {/* ── Kick Count ─────────────────────────────────────────────────────────
       *
       * B-1: All 5 KickCount screens registered.
       * Props derived from profileSnapshot (set by HomeScreen.onProfileLoaded).
       * kickProps uses safe defaults (gestationalWeek=0, consent=false) until
       * the profile loads — this prevents accessing the feature before auth.
       *
       * Security: no health data in route params (K-8 PDPA). Profile data
       * flows from HomeScreen → RootNavigator state → screen props only.
       */}

      {/* SC-K0: KickCount entry / module home */}
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

      {/* SC-K3: Post-finalize summary — reads sessionId from route.params */}
      <Stack.Screen
        name="KickCountSummary"
        component={KickCountSummaryScreen}
        options={{ title: t('kick.summaryHeadline'), headerBackTitle: t('general.back') }}
      />

      {/* SC-K4: History list */}
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

      {/* SC-K5: Session detail — reads sessionId from route.params */}
      <Stack.Screen
        name="KickCountDetail"
        component={KickCountDetailScreen}
        options={{ title: t('kick.detailNavTitle'), headerBackTitle: t('general.back') }}
      />
    </Stack.Navigator>
  );
}
