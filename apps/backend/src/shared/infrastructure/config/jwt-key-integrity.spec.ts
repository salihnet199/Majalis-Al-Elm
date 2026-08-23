import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  TEST_ONLY_JWT_SECRET,
  assertJwtKeyIntegrity,
} from './jwt-key-integrity';
import { validateConfig } from './app.config';

/**
 * POLICY-SEC-001 / TECH-DEBT-013 regression suite.
 *
 * The vulnerability: JwtRs256Adapter and JwtStrategy silently downgraded to
 * HS256 signed with a public constant whenever no RS256 key was configured,
 * gated only on `NODE_ENV === 'test'`, while the Joi schema required no JWT key
 * at all. A container mis-set to NODE_ENV=test booted happily and accepted
 * attacker-forged tokens for any role.
 *
 * These tests fail the moment either protective layer is weakened:
 *   layer 1 — the Joi rule in app.config.ts (rejects missing/sentinel env vars)
 *   layer 2 — assertJwtKeyIntegrity() in main.ts (rejects sentinel key MATERIAL,
 *             including material injected through a key file, which layer 1
 *             cannot inspect)
 */

// A genuine RS256 pair, so the "valid configuration" cases prove the guard
// accepts real keys rather than merely rejecting everything.
const { privateKey: REAL_PRIVATE_PEM, publicKey: REAL_PUBLIC_PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const DB_ENV = {
  DATABASE_HOST: 'localhost',
  DATABASE_NAME: 'majaliselm',
  DATABASE_USER: 'majaliselm',
  DATABASE_PASSWORD: 'irrelevant-for-these-tests',
};

// validateConfig also requires object storage outside NODE_ENV=test (ADR-013).
// The cases below that assert a config is ACCEPTED must therefore supply it, or
// they would pass/fail for a reason unrelated to JWT. Storage-specific rules are
// covered in storage-integrity.spec.ts.
const S3_ENV = {
  S3_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com',
  S3_ACCESS_KEY: 'irrelevant-for-these-tests',
  S3_SECRET_KEY: 'irrelevant-for-these-tests-32-chars',
  S3_BUCKET_NAME: 'majalis-elm-media',
  S3_REGION: 'auto',
};

let fixtureDir: string;
let sentinelKeyFile: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'jwt-key-integrity-'));
  sentinelKeyFile = join(fixtureDir, 'leaked-test-secret.key');
  writeFileSync(sentinelKeyFile, `${TEST_ONLY_JWT_SECRET}\n`, 'utf-8');
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('layer 2 — assertJwtKeyIntegrity() refuses to boot on weak signing material', () => {
  it('allows NODE_ENV=test to run on the symmetric secret (the one permitted case)', () => {
    expect(() => assertJwtKeyIntegrity({ NODE_ENV: 'test' })).not.toThrow();
  });

  it.each(['production', 'staging', 'development'])(
    'throws under NODE_ENV=%s when no key is configured at all',
    (nodeEnv) => {
      expect(() => assertJwtKeyIntegrity({ NODE_ENV: nodeEnv })).toThrow(/JWT private key is missing/);
    },
  );

  it('treats an unset NODE_ENV as key-required, never as test', () => {
    // Fail-safe direction: absence of configuration must not unlock the weak path.
    expect(() => assertJwtKeyIntegrity({})).toThrow(/refusing to start/);
  });

  it('rejects the test sentinel supplied as an inline private key', () => {
    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: TEST_ONLY_JWT_SECRET,
        JWT_PUBLIC_KEY: REAL_PUBLIC_PEM,
      }),
    ).toThrow(/JWT private key is the test-only symmetric secret/);
  });

  it('rejects the test sentinel supplied as an inline public key', () => {
    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: REAL_PRIVATE_PEM,
        JWT_PUBLIC_KEY: TEST_ONLY_JWT_SECRET,
      }),
    ).toThrow(/JWT public key is the test-only symmetric secret/);
  });

  it('rejects the test sentinel arriving through a KEY FILE — layer 1 cannot see this', () => {
    // The entire reason this second layer exists: Joi validates env var values,
    // so a path pointing at a file whose *contents* are the sentinel passes
    // layer 1 untouched.
    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: sentinelKeyFile,
        JWT_PUBLIC_KEY_PATH: sentinelKeyFile,
      }),
    ).toThrow(/is the test-only symmetric secret/);
  });

  it('rejects a symmetric password masquerading as an RS256 key', () => {
    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: 'correct-horse-battery-staple',
        JWT_PUBLIC_KEY: 'correct-horse-battery-staple',
      }),
    ).toThrow(/is not PEM-encoded/);
  });

  it('throws rather than falling back when a key file is unreadable', () => {
    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: join(fixtureDir, 'does-not-exist.pem'),
      }),
    ).toThrow(/could not be read/);
  });

  it('accepts a genuine RS256 PEM pair from inline env vars', () => {
    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: REAL_PRIVATE_PEM,
        JWT_PUBLIC_KEY: REAL_PUBLIC_PEM,
      }),
    ).not.toThrow();
  });

  it('accepts a genuine RS256 PEM pair from key files', () => {
    const privatePath = join(fixtureDir, 'real-private.pem');
    const publicPath = join(fixtureDir, 'real-public.pem');
    writeFileSync(privatePath, REAL_PRIVATE_PEM, 'utf-8');
    writeFileSync(publicPath, REAL_PUBLIC_PEM, 'utf-8');

    expect(() =>
      assertJwtKeyIntegrity({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: privatePath,
        JWT_PUBLIC_KEY_PATH: publicPath,
      }),
    ).not.toThrow();
  });

  it('reports every problem at once instead of only the first', () => {
    try {
      assertJwtKeyIntegrity({ NODE_ENV: 'production' });
      throw new Error('expected assertJwtKeyIntegrity to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/JWT private key is missing/);
      expect(message).toMatch(/JWT public key is missing/);
    }
  });
});

describe('layer 1 — validateConfig() Joi rule requires a real key pair outside tests', () => {
  it('rejects a production config with no JWT key', () => {
    expect(() => validateConfig({ ...DB_ENV, NODE_ENV: 'production' })).toThrow(
      /a JWT RS256 key pair is required outside NODE_ENV=test/,
    );
  });

  it('rejects a staging config with no JWT key', () => {
    expect(() => validateConfig({ ...DB_ENV, NODE_ENV: 'staging' })).toThrow(
      /a JWT RS256 key pair is required outside NODE_ENV=test/,
    );
  });

  it('rejects a config whose NODE_ENV is unset — default is development, not test', () => {
    expect(() => validateConfig({ ...DB_ENV })).toThrow(
      /a JWT RS256 key pair is required outside NODE_ENV=test/,
    );
  });

  it('rejects the test sentinel exported as a real JWT env var', () => {
    expect(() =>
      validateConfig({
        ...DB_ENV,
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: TEST_ONLY_JWT_SECRET,
        JWT_PUBLIC_KEY: TEST_ONLY_JWT_SECRET,
      }),
    ).toThrow(/the test-only symmetric secret must never be used as a JWT key/);
  });

  it('requires the PUBLIC half too — a private key alone is not enough', () => {
    expect(() =>
      validateConfig({ ...DB_ENV, NODE_ENV: 'production', JWT_PRIVATE_KEY: REAL_PRIVATE_PEM }),
    ).toThrow(/a JWT RS256 key pair is required outside NODE_ENV=test/);
  });

  it('accepts a production config with a real key pair', () => {
    expect(() =>
      validateConfig({
        ...DB_ENV,
        ...S3_ENV,
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: REAL_PRIVATE_PEM,
        JWT_PUBLIC_KEY: REAL_PUBLIC_PEM,
      }),
    ).not.toThrow();
  });

  it('accepts key paths instead of inline values', () => {
    expect(() =>
      validateConfig({
        ...DB_ENV,
        ...S3_ENV,
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY_PATH: '/run/secrets/jwt_private.pem',
        JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt_public.pem',
      }),
    ).not.toThrow();
  });

  it('still lets the test suite boot without any JWT key', () => {
    expect(() => validateConfig({ ...DB_ENV, NODE_ENV: 'test' })).not.toThrow();
  });
});
