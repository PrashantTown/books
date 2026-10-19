module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  verbose: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
  ],
};