# mom_starter_mobile

React Native (Expo managed workflow) app for the Mom-Starter pregnancy companion.

## Stack

- Expo SDK 51 (managed workflow)
- React Native 0.74
- TypeScript 5
- React Navigation v6 (native-stack)
- expo-secure-store (Keychain/Keystore for tokens)
- Spring Boot API at `http://localhost:8080` (see src/config.ts)

## First-time setup

After cloning, install dependencies:

```bash
npx expo install
```

This pins all package versions to those compatible with the Expo SDK version
declared in package.json. Do NOT use plain `npm install` for Expo packages.

## Running the app

```bash
# Start Metro bundler + QR code (default)
npx expo start

# Open on a connected Android device / emulator
npx expo start --android   # or press 'a' in the Expo CLI

# Open on iOS Simulator (macOS only)
npx expo start --ios       # or press 'i'

# Open in browser (limited — no native modules)
npx expo start --web       # or press 'w'
```

### Expo Go (quickest for physical devices)

1. Install Expo Go on the device (App Store / Play Store)
2. Run `npx expo start`
3. Scan the QR code shown in the terminal

## UAT on a physical device (important — API base URL)

The app connects to the Spring Boot API. By default `src/config.ts` uses
`http://localhost:8080`. This works in:

- iOS Simulator (Mac) — shares the Mac's network stack
- Android Emulator with host alias `10.0.2.2` (emulator-specific)

**For physical Android devices or when localhost does not resolve**, change
`API_BASE_URL` in `src/config.ts` to your dev machine's LAN IP:

```ts
// src/config.ts
export const API_BASE_URL = 'http://192.168.1.10:8080';  // your Mac's LAN IP
```

How to find your Mac's LAN IP:
- System Settings → Wi-Fi → [network name] → Details → IP Address
- Or: `ipconfig getifaddr en0` in Terminal

Make sure the Spring Boot server is running and the firewall allows port 8080.

## Running tests

```bash
npm test
```

125 unit tests covering auth logic (loginScreenLogic, registerScreenLogic,
verifyEmailScreenLogic, authApiClient, tokenStorage). Tests run in Node
environment via ts-jest and do NOT require a device or Metro bundler.

## Type checking

```bash
npm run typecheck
```

## Project structure

```
App.tsx                       Expo entry point (NavigationContainer + StatusBar)
app.json                      Expo managed-workflow config (name, scheme, icons)
babel.config.js               babel-preset-expo
src/
  config.ts                   API base URL (single place to configure for UAT)
  navigation/
    types.ts                  RootStackParamList (route params type)
    RootNavigator.tsx         Native-stack navigator (Welcome→Login/Register→Home)
  auth/
    LoginScreen.tsx           Sign-in UI (S4)
    RegisterScreen.tsx        Sign-up UI (S2)
    VerifyEmailScreen.tsx     Check-inbox UI (S3)
    secureTokenStorage.ts     expo-secure-store implementation of TokenStorage
    tokenStorage.ts           TokenStorage interface + InMemoryTokenStorage (tests)
    authApiClient.ts          Auth REST client (createAuthClient)
    loginScreenLogic.ts       Testable login logic (handleSignIn, validateEmail…)
    registerScreenLogic.ts    Testable register logic
    verifyEmailScreenLogic.ts Testable verify/resend logic
    types.ts                  Auth domain types (AuthTokens, LoginRequest…)
  screens/
    WelcomeScreen.tsx         Landing / splash (S1)
    HomeScreen.tsx            Post-auth placeholder dashboard
```

## Deep-link (carry-forward)

The URL scheme `momstarter://` is registered in `app.json` under `"scheme"`.
Email-verification links (`momstarter://verify?token=...`) are handled by
`VerifyEmailScreen` via the `pendingToken` prop. Wiring Expo Linking to
extract the token from the URL and pass it to the screen is a carry-forward
for the next slice.
