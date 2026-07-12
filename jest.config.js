/** @type {import('ts-jest').JestConfigWithTsJest} */
//
// Two projects:
//   1. "logic"  — existing pure-TS/ts-jest suite (fast, node env, no RN rendering).
//   2. "rntl"   — REAL component-render tests (jest-expo preset + RNTL) for
//      *.rntl.test.tsx files. These actually mount screens and dispatch real
//      onPress/fireEvent — required to catch UI-only bugs (duplicate back
//      buttons, dead toggle handlers) that pure-logic tests cannot see.
//      See: owner-reported bugs #1/#2/#3 (2026-07) — root cause was that NO
//      test in this repo rendered a real screen or invoked a real handler.
module.exports = {
  projects: [
    {
      displayName: 'logic',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      setupFiles: ['<rootDir>/jest.setup.tz.js'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '\\.mock\\.ts$',
        '\\.rntl\\.test\\.tsx$',
      ],
    },
    {
      displayName: 'rntl',
      preset: 'jest-expo',
      roots: ['<rootDir>/src'],
      setupFiles: ['<rootDir>/jest.setup.tz.js'],
      setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
      testMatch: ['**/*.rntl.test.tsx'],
      // Extend (not replace) jest-expo's default transformIgnorePatterns[0]
      // allowlist to also transform `uuid`'s ESM build (RootNavigator pulls
      // in profileVerbQueue.ts, which imports uuid).
      transformIgnorePatterns: [
        '/node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|uuid)',
        '/node_modules/react-native-reanimated/plugin/',
      ],
    },
  ],
};
