// Ensure NODE_ENV=test is always set so JwtRs256Adapter activates its
// HS256 test-only fallback when no RSA keys are configured.
// Force-set to 'test' unconditionally — do NOT defer to an inherited shell
// value (e.g. NODE_ENV=production from IDE or system env), which caused 56
// test failures whenever the environment had a pre-set NODE_ENV.
process.env.NODE_ENV = 'test';

module.exports = {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }]
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/backend',
  // Suites that need live infrastructure are not part of the default run: they
  // would turn `nx test backend` red on any machine without MinIO or Postgres up.
  // They are NOT skippable-at-runtime — see jest.storage-integration.config.cts,
  // jest.db-integration.config.cts, and the suites themselves, which fail loudly
  // when their infrastructure is absent rather than passing with a warning.
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.minio\\.integration\\.spec\\.ts$',
    '\\.pg\\.integration\\.spec\\.ts$'
  ]
};
