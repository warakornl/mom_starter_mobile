/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Pin timezone so helpers are tested against a non-UTC locale.
  // See jest.setup.tz.js for rationale.
  setupFiles: ['<rootDir>/jest.setup.tz.js'],
};
