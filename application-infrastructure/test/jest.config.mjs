export default {
  testMatch: [
    '**/test/unit/**/*.jest.mjs',
    '**/test/property/**/*.jest.mjs'
  ],
  transform: {},
  testEnvironment: 'node',
  verbose: true,
  moduleNameMapper: {
    '^sharp$': '<rootDir>/test/__mocks__/sharp.mjs'
  }
};
