// Unit and component tests: Jest with Expo's preset and React Native Testing Library.
// Test files: `*.test.ts(x)` under src/ and test/ (never under app/: every file there is a screen).
// ../shared, which the app imports, is transformed with the same Babel set-up.
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)', '<rootDir>/test/**/*.test.ts?(x)'],
  transform: { '\\.[jt]sx?$': ['babel-jest', { configFile: require.resolve('./babel.config.js') }] },
};
