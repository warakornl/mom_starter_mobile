/**
 * RootNavigator — root native-stack navigator.
 *
 * Route map:
 *   Welcome → Login | Register
 *   Login → Home (on success) | Register (create account link)
 *   Register → VerifyEmail (on 202) | Login (sign-in link)
 *   VerifyEmail → Home (on verify success) | Register (change email)
 *   Home — placeholder dashboard (logout → Welcome)
 *
 * Design decisions:
 * - Auth screens keep their callback-based prop API (onSuccess, onSignIn, etc.)
 *   and are wired to navigation via render-prop children inside Stack.Screen.
 *   This decouples the screen components from react-navigation and keeps their
 *   existing logic testable without a navigation environment.
 * - Login and VerifyEmail success use `navigation.reset` to clear the auth stack
 *   so the user cannot "back" into the sign-in screen after logging in.
 * - tokenStorage and apiBaseUrl are passed in from App.tsx (created once with
 *   useMemo) so auth screens share the same storage instance.
 *
 * Carry-forward:
 * - ForgotPassword screen (onForgotPassword is currently a no-op)
 * - Expo Linking deep-link handler to extract `pendingToken` from the
 *   momstarter://verify?token=... URL and pass to VerifyEmailScreen
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

      {/* Home — placeholder dashboard */}
      <Stack.Screen
        name="Home"
        options={{ headerShown: false }}
      >
        {({ navigation }) => (
          <HomeScreen
            tokenStorage={tokenStorage}
            onLogout={() =>
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })
            }
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
