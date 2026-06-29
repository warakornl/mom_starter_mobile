# mom_starter_mobile

React Native (Expo managed workflow) app for the Mom-Starter pregnancy companion.

## คู่มือทดสอบ UAT และ Build (ภาษาไทย)

สำหรับวิธีทดสอบแบบ step-by-step ครอบคลุม Expo Go, iOS Simulator, Android Emulator, และ EAS Build — รวมถึงการตั้ง API base URL ก่อน standalone build — ดูที่:

**[docs/uat-and-build.md](./docs/uat-and-build.md)**

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

The app connects to the Spring Boot API. `src/config.ts` auto-resolves the
dev machine's LAN IP from Expo's `hostUri` — no manual IP edits needed when
using **Expo Go** on the same Wi-Fi network.

For **standalone EAS builds** (`.ipa` / `.apk`), `hostUri` is not available,
so the app falls back to `localhost`. Set `extra.apiBaseUrl` in `app.json`
before building:

```json
"extra": {
  "apiBaseUrl": "http://192.168.1.10:8080"
}
```

Replace `192.168.1.10` with your Mac's LAN IP (`ipconfig getifaddr en0`).

Make sure the Spring Boot server is running, bound to `0.0.0.0` (not just
`localhost`), and the firewall allows port 8080.

See [docs/uat-and-build.md](./docs/uat-and-build.md) for the full walkthrough
in Thai.

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
