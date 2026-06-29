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

const Stack = createNativeStackNavigator<RootStackParamList>();

interface RootNavigatorProps {
  /** Secure token storage shared across all auth screens. */
  tokenStorage: TokenStorage;
  /** API base URL from src/config.ts. */
  apiBaseUrl: string;
}

export function RootNavigator({ tokenStorage, apiBaseUrl }: RootNavigatorProps): React.JSX.Element {
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
        options={{ title: 'เข้าสู่ระบบ', headerBackTitle: '' }}
      >
        {({ navigation }) => (
          <LoginScreen
            apiBaseUrl={apiBaseUrl}
            locale="th"
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
        options={{ title: 'สร้างบัญชี', headerBackTitle: '' }}
      >
        {({ navigation }) => (
          <RegisterScreen
            apiBaseUrl={apiBaseUrl}
            locale="th"
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
        options={{ title: 'ยืนยันอีเมล', headerBackVisible: false }}
      >
        {({ route, navigation }) => (
          <VerifyEmailScreen
            apiBaseUrl={apiBaseUrl}
            locale="th"
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
          />
        )}
      </Stack.Screen>

      {/* ProfileSetup — initial due-date / current-week entry (US-1) */}
      <Stack.Screen
        name="ProfileSetup"
        options={{ title: 'ตั้งกำหนดคลอด', headerBackTitle: '' }}
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
        options={{ title: 'ลูกคลอดแล้ว', headerBackTitle: 'กลับ' }}
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
    </Stack.Navigator>
  );
}
