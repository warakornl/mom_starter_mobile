/**
 * RootNavigator — root native-stack navigator.
 *
 * Route map:
 *   Welcome → Login | Register
 *   Login → Home (on success) | Register (create account link)
 *   Register → VerifyEmail (on 202) | Login (sign-in link)
 *   VerifyEmail → Home (on verify success) | Register (change email)
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
 * - Consent screen between VerifyEmail and ProfileSetup
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './types';
import type { TokenStorage } from '../auth/tokenStorage';

import { WelcomeScreen } from '../screens/WelcomeScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../auth/LoginScreen';
import { RegisterScreen } from '../auth/RegisterScreen';
import { VerifyEmailScreen } from '../auth/VerifyEmailScreen';
import { ProfileSetupScreen } from '../pregnancy/ProfileSetupScreen';
import { BirthEventScreen } from '../pregnancy/BirthEventScreen';
import { SuppliesScreen } from '../supplies/SuppliesScreen';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { AppointmentFormScreen } from '../calendar/AppointmentFormScreen';
import { ReminderFormScreen } from '../calendar/ReminderFormScreen';
import { calendarSyncStore } from '../sync/calendarSyncStore';
import { useT } from '../i18n/LanguageContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

interface RootNavigatorProps {
  /** Secure token storage shared across all auth screens. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
}

export function RootNavigator({ tokenStorage, apiBaseUrl }: RootNavigatorProps): React.JSX.Element {
  const { t } = useT();

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
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
            }
            onChangeEmail={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Register' }] })
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
       */}
      <Stack.Screen
        name="Home"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <HomeScreen
            tokenStorage={tokenStorage}
            apiBaseUrl={apiBaseUrl}
            onLogout={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })
            }
            onNeedsProfile={() =>
              navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] })
            }
            onBirthEvent={(profileVersion) =>
              navigation.navigate('BirthEvent', { profileVersion })
            }
            onSupplies={() => navigation.navigate('Supplies')}
            onCalendar={() => navigation.navigate('Calendar')}
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

      {/* Calendar — month/agenda (calendar + reminder occurrences + appointments)
       *
       * Entry: "ดูทั้งหมด" / calendar button on HomeScreen.
       * CalendarScreen receives navigation callbacks for add/edit forms.
       */}
      <Stack.Screen
        name="Calendar"
        options={{ title: t('calendar.navTitle'), headerBackTitle: t('general.back') }}
      >
        {({ navigation }) => (
          <CalendarScreen
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
              onSave={() => navigation.goBack()}
              onCancel={() => navigation.goBack()}
            />
          );
        }}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
