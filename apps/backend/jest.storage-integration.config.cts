/**
 * Jest config for the storage integration suite — real MinIO, real HTTP, real bytes.
 *
 *     docker compose --env-file .env.local up -d minio
 *     node scripts/ensure-media-bucket.mjs
 *     npx nx run backend:test-storage
 *
 * Separate from `jest.config.cts` for one reason: the default test run must stay
 * runnable on a machine with no infrastructure, and this suite must NOT be
 * skippable. Those two requirements are irreconcilable in a single config — a
 * suite that quietly skips when MinIO is missing reports green while proving
 * nothing, which is exactly the class of false claim ADR-013 Stage A exists to
 * eliminate. So: excluded from the default run by path, and unconditionally
 * failing when invoked without storage.
 */

const base = require('./jest.config.cts');

module.exports = {
  ...base,
  displayName: 'backend:storage-integration',
  // Clears the base config's exclusion of exactly these files.
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['<rootDir>/src/**/*.minio.integration.spec.ts'],
  // A >100 MB multipart upload over the loopback interface is not a unit test.
  testTimeout: 600_000,
  // One worker: the suite shares a single bucket, and parallel workers racing
  // over the same keys would produce failures that say nothing about the code.
  maxWorkers: 1,
};
