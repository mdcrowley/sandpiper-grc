// Unit and component tests: Jest with Expo's preset and React Native Testing Library.
// Test files: `*.test.ts(x)` under src/ and test/ (never under app/: every file there is a screen).
// ../shared, which the app imports, is transformed with the same Babel set-up.
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  // ../shared resolves its imports (the Babel helpers) from the app's own packages: CI installs
  // only mobile/ for this job, so there is no repository-root node_modules to fall back on.
  modulePaths: ['<rootDir>/node_modules'],
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)', '<rootDir>/test/**/*.test.ts?(x)'],
  transform: { '\\.[jt]sx?$': ['babel-jest', { configFile: require.resolve('./babel.config.js') }] },
};
