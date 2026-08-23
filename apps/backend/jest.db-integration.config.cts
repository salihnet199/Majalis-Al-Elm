/**
 * Jest config for the database integration suites — real Postgres, real SQL.
 *
 *     docker compose --env-file .env.local up -d postgres
 *     npx nx run backend:test-db
 *
 * Separate from `jest.config.cts` for the same reason as the storage config: the
 * default run must stay green on a machine with no infrastructure, and these
 * suites must NOT be skippable. A hand-written QueryBuilder query can reference a
 * column that does not exist, compare text to an enum, or subquery a missing
 * table, and a mocked repository will report green on all three — so the SQL is
 * only ever proven by running it. Excluded from the default run by path;
 * unconditionally failing when invoked without a reachable database.
 */

const base = require('./jest.config.cts');

module.exports = {
  ...base,
  displayName: 'backend:db-integration',
  // Clears the base config's exclusion of exactly these files.
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['<rootDir>/src/**/*.pg.integration.spec.ts'],
  // Connecting, seeding and purging is slower than a unit test, and the failure
  // when Postgres is down should be the connection error, not a timeout.
  testTimeout: 120_000,
  // One worker: the suites seed and delete rows in a shared database, and parallel
  // workers racing over the same tables would produce failures that say nothing
  // about the code.
  maxWorkers: 1,
};
