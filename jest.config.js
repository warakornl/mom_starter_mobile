/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Pin timezone so helpers are tested against a non-UTC locale.
  // See jest.setup.tz.js for rationale.
  setupFiles: ['<rootDir>/jest.setup.tz.js'],
  // Exclude helper/mock files in __tests__ dirs that contain no test cases.
  // Jest picks up all files in __tests__/ by default; .mock.ts files are
  // shared fixtures (no describe/it blocks) and must not be run as suites.
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.mock\\.ts$',
  ],
};
