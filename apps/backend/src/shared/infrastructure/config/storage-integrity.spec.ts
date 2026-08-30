import { generateKeyPairSync } from 'crypto';
import {
  WELL_KNOWN_STORAGE_CREDENTIALS,
  assertStorageIntegrity,
} from './storage-integrity';
import { s3ConfigRequirementSchema, validateConfig } from './app.config';

/**
 * ADR-013 / POLICY-SEC-001 regression suite for the object-storage guard.
 *
 * The sponsor's Stage A decision of 2026-08-22 is a single sentence: **"لا تراجع
 * صامت لحالة بلا رفع ملفات"** — the server must not come up in a state where
 * media upload does not work. This suite is what makes that sentence hold after
 * someone edits the config in six months.
 *
 * It is the sibling of jwt-key-integrity.spec.ts, and exists for the same reason
 * that one does: TECH-DEBT-013 was not a missing check, it was a check that had
 * been silently relaxed. So each of the three layers is tested for what it alone
 * can catch:
 *
 *   layer 1  s3ConfigRequirementSchema (app.config.ts) — the vars are PRESENT
 *            and well-formed outside NODE_ENV=test
 *   layer 2  assertStorageIntegrity() (main.ts, before NestFactory.create) — the
 *            VALUES are safe for the target environment
 *   layer 3  S3StorageAdapter.assertReachable() — the bucket really exists and
 *            answers. Not testable here by construction: only a live network
 *            call proves it, which is s3-storage.minio.integration.spec.ts
 *            ("assertReachable fails loudly for a bucket that does not exist").
 *
 * A note on what is deliberately NOT asserted: nowhere does any test permit a
 * "storage disabled" mode, because no such mode exists in the codebase. If one is
 * ever added, these tests keep passing — which is why the suite also pins the
 * absence of a bypass env var (last describe block).
 */

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

/** Real keys, so an accepted config is accepted for storage reasons, not JWT ones. */
const JWT_ENV = {
  JWT_PRIVATE_KEY: REAL_PRIVATE_PEM,
  JWT_PUBLIC_KEY: REAL_PUBLIC_PEM,
};

/** A configuration that should be accepted everywhere — the R2 shape from ADR-013. */
const GOOD_STORAGE = {
  S3_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com',
  S3_ACCESS_KEY: 'AKIAREALLOOKINGKEY123456',
  S3_SECRET_KEY: 'a-real-secret-of-sufficient-length-32',
  S3_BUCKET_NAME: 'majalis-elm-media',
  S3_REGION: 'auto',
};

/** The local MinIO shape the sponsor approved for Stage A. */
const LOCAL_STORAGE = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_BASE_URL: 'http://localhost:9000',
  S3_ACCESS_KEY: 'majaliselm-local-dev-only',
  S3_SECRET_KEY: 'majaliselm-local-dev-only-secret-key',
  S3_BUCKET_NAME: 'majalis-elm-media',
  S3_REGION: 'us-east-1',
};

// ════ Layer 1: the variables must be there ════════════════════════════════════

describe('layer 1 — validateConfig requires object storage outside NODE_ENV=test', () => {
  it.each(['production', 'staging', 'development'])(
    'rejects a configuration with no S3 block at all under NODE_ENV=%s',
    (nodeEnv) => {
      // This is the whole sponsor decision in one assertion: without storage
      // configured, the process does not start. There is no third outcome.
      expect(() => validateConfig({ ...DB_ENV, ...JWT_ENV, NODE_ENV: nodeEnv })).toThrow(
        /S3_ENDPOINT.*required/i,
      );
    },
  );

  it('treats an UNSET NODE_ENV as development, so storage is still required', () => {
    // Fail-safe direction. An unset NODE_ENV must never be read as "probably a
    // test run" — that inversion is exactly what made TECH-DEBT-013 exploitable.
    expect(() => validateConfig({ ...DB_ENV, ...JWT_ENV })).toThrow(/S3_/);
  });

  it('accepts a complete S3 block', () => {
    expect(() =>
      validateConfig({ ...DB_ENV, ...JWT_ENV, ...GOOD_STORAGE, NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it('accepts the local MinIO block under development', () => {
    expect(() =>
      validateConfig({ ...DB_ENV, ...JWT_ENV, ...LOCAL_STORAGE, NODE_ENV: 'development' }),
    ).not.toThrow();
  });

  it.each(['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET_NAME', 'S3_REGION'])(
    'rejects a configuration missing %s',
    (missing) => {
      const storage: Record<string, string> = { ...GOOD_STORAGE };
      delete storage[missing];
      expect(() =>
        validateConfig({ ...DB_ENV, ...JWT_ENV, ...storage, NODE_ENV: 'production' }),
      ).toThrow(new RegExp(missing));
    },
  );

  it('rejects an endpoint that is not an absolute http(s) URL', () => {
    const { error } = s3ConfigRequirementSchema.validate({
      ...GOOD_STORAGE,
      S3_ENDPOINT: 'example-account.r2.cloudflarestorage.com',
    });
    expect(error?.message).toMatch(/absolute http\(s\) URL/);
  });

  it('rejects an S3_PUBLIC_BASE_URL that is present but malformed', () => {
    // Optional, but not optional-to-be-valid: presigned URLs are signed against
    // this host, so a broken value produces uploads that 403 with no explanation.
    const { error } = s3ConfigRequirementSchema.validate({
      ...GOOD_STORAGE,
      S3_PUBLIC_BASE_URL: 'localhost:9000',
    });
    expect(error?.message).toMatch(/S3_PUBLIC_BASE_URL/);
  });

  it('allows S3_PUBLIC_BASE_URL to be absent (the R2 and AWS case)', () => {
    const { error } = s3ConfigRequirementSchema.validate(GOOD_STORAGE);
    expect(error).toBeUndefined();
  });

  it('rejects a bucket name shorter than the S3 minimum', () => {
    const { error } = s3ConfigRequirementSchema.validate({
      ...GOOD_STORAGE,
      S3_BUCKET_NAME: 'ab',
    });
    expect(error?.message).toMatch(/S3_BUCKET_NAME/);
  });

  it('exempts only an explicit NODE_ENV=test, where the suite injects its own adapter', () => {
    expect(() => validateConfig({ ...DB_ENV, NODE_ENV: 'test' })).not.toThrow();
  });
});

// ════ Layer 2: the values must be safe for where they are running ═════════════

describe('layer 2 — assertStorageIntegrity() accepts real configurations', () => {
  it('accepts the production R2 shape', () => {
    expect(() =>
      assertStorageIntegrity({ NODE_ENV: 'production', ...GOOD_STORAGE }),
    ).not.toThrow();
  });

  it('accepts local MinIO over plain HTTP under development', () => {
    // Cleartext and loopback are fine on a laptop. The point of layer 2 is that
    // they stop being fine the moment NODE_ENV says this is a deployment.
    expect(() =>
      assertStorageIntegrity({ NODE_ENV: 'development', ...LOCAL_STORAGE }),
    ).not.toThrow();
  });

  it('returns without checking anything under NODE_ENV=test', () => {
    expect(() => assertStorageIntegrity({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('treats an unset NODE_ENV as development and still demands the variables', () => {
    expect(() => assertStorageIntegrity({})).toThrow(/S3_ENDPOINT is missing/);
  });
});

describe('layer 2 — presence, reported all at once', () => {
  it('lists every missing variable rather than only the first', () => {
    // A developer fixing five variables one boot at a time is a developer who
    // eventually reaches for a bypass.
    let message = '';
    try {
      assertStorageIntegrity({ NODE_ENV: 'development' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('S3_ENDPOINT is missing');
    expect(message).toContain('S3_ACCESS_KEY is missing');
    expect(message).toContain('S3_SECRET_KEY is missing');
    expect(message).toContain('S3_BUCKET_NAME is missing');
    expect(message).toContain('S3_REGION is missing');
  });

  it('says plainly that there is no fallback mode', () => {
    // The message is part of the control: it has to remove "just disable uploads
    // for now" from the reader's list of options.
    expect(() => assertStorageIntegrity({ NODE_ENV: 'development' })).toThrow(
      /no ["“]storage disabled["”] mode/i,
    );
    expect(() => assertStorageIntegrity({ NODE_ENV: 'development' })).toThrow(
      /refusing to start/i,
    );
  });

  it('treats whitespace-only values as missing', () => {
    expect(() =>
      assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_ACCESS_KEY: '   ' }),
    ).toThrow(/S3_ACCESS_KEY is missing/);
  });
});

describe('layer 2 — credential quality in hardened environments', () => {
  it.each(['production', 'staging'])(
    'rejects every well-known default credential under NODE_ENV=%s',
    (nodeEnv) => {
      for (const credential of WELL_KNOWN_STORAGE_CREDENTIALS) {
        expect(() =>
          assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: nodeEnv, S3_ACCESS_KEY: credential }),
        ).toThrow(/well-known default credential/);
      }
    },
  );

  it('rejects a well-known default as the SECRET too, without echoing it', () => {
    let message = '';
    try {
      assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_SECRET_KEY: 'minioadmin' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/S3_SECRET_KEY is a well-known default credential/);
    // The access key is echoed to help identify it; the secret never is, so a
    // boot log does not become a place where secrets are found.
    expect(message).not.toContain('minioadmin');
  });

  it('matches well-known credentials case-insensitively and around whitespace', () => {
    expect(() =>
      assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_ACCESS_KEY: ' MinioAdmin ' }),
    ).toThrow(/well-known default credential/);
  });

  it('rejects the local-dev credentials that ship in .env.example', () => {
    // The exact scenario: .env.example (or a developer's .env.local) is copied
    // onto a server. The "local-dev-only" marker in those values is what makes
    // that a boot failure instead of a production bucket guarded by a value
    // published in this repository.
    expect(() =>
      assertStorageIntegrity({ ...LOCAL_STORAGE, NODE_ENV: 'production' }),
    ).toThrow(/placeholder value from \.env\.example/);
  });

  it.each(['<replace-me>', 'your-access-key', 'XXX', 'TODO', 'changeme'])(
    'rejects the placeholder %s left behind from .env.example',
    (placeholder) => {
      expect(() =>
        assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_ACCESS_KEY: placeholder }),
      ).toThrow(/placeholder|well-known/i);
    },
  );

  it('rejects a secret too short to be worth anything', () => {
    expect(() =>
      assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_SECRET_KEY: 'short-secret' }),
    ).toThrow(/only 12 characters/);
  });

  it('does not apply hardened credential rules to development', () => {
    // Otherwise every developer's first experience of this guard is fighting it,
    // and the guard loses. Local weakness is allowed; deployed weakness is not.
    expect(() =>
      assertStorageIntegrity({ ...LOCAL_STORAGE, NODE_ENV: 'development', S3_ACCESS_KEY: 'minioadmin', S3_SECRET_KEY: 'minioadmin' }),
    ).not.toThrow();
  });
});

describe('layer 2 — transport and host, in hardened environments', () => {
  it.each(['production', 'staging'])(
    'refuses cleartext HTTP for S3_ENDPOINT under NODE_ENV=%s',
    (nodeEnv) => {
      // A presigned URL is a bearer credential. Over HTTP anyone on the path can
      // replay it until it expires, and the media bytes travel in the clear too.
      expect(() =>
        assertStorageIntegrity({
          ...GOOD_STORAGE,
          NODE_ENV: nodeEnv,
          S3_ENDPOINT: 'http://storage.internal:9000',
        }),
      ).toThrow(/must use https/);
    },
  );

  it('refuses cleartext HTTP for S3_PUBLIC_BASE_URL as well', () => {
    // This is the host the editor's BROWSER is told to upload to, so it is
    // exactly as sensitive as the endpoint the server uses.
    expect(() =>
      assertStorageIntegrity({
        ...GOOD_STORAGE,
        NODE_ENV: 'production',
        S3_PUBLIC_BASE_URL: 'http://media.majalis-elm.example',
      }),
    ).toThrow(/S3_PUBLIC_BASE_URL must use https/);
  });

  it.each(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal'])(
    'refuses the loopback host %s in production',
    (host) => {
      // A deployed server pointed at its own loopback has no storage at all —
      // which would surface as a failed upload in front of a real user.
      expect(() =>
        assertStorageIntegrity({
          ...GOOD_STORAGE,
          NODE_ENV: 'production',
          S3_ENDPOINT: `https://${host}:9000`,
        }),
      ).toThrow(/loopback host/);
    },
  );

  it('refuses an endpoint carrying a path', () => {
    // The SDK would prefix that path to the bucket, so every object would land
    // somewhere other than where the database says it is.
    expect(() =>
      assertStorageIntegrity({
        ...GOOD_STORAGE,
        NODE_ENV: 'production',
        S3_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com/majalis-elm-media',
      }),
    ).toThrow(/must not contain a path/);
  });

  it('refuses an endpoint with credentials embedded in the URL', () => {
    expect(() =>
      assertStorageIntegrity({
        ...GOOD_STORAGE,
        NODE_ENV: 'production',
        S3_ENDPOINT: 'https://key:secret@example-account.r2.cloudflarestorage.com',
      }),
    ).toThrow(/must not embed credentials/);
  });

  it.each(['ftp://storage.example', 'file:///etc/passwd', 's3://bucket'])(
    'refuses the non-HTTP scheme in %s',
    (endpoint) => {
      expect(() =>
        assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_ENDPOINT: endpoint }),
      ).toThrow(/must use http or https|not a valid absolute URL/);
    },
  );

  it('refuses a value that is not a URL at all', () => {
    expect(() =>
      assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_ENDPOINT: 'not a url' }),
    ).toThrow(/not a valid absolute URL/);
  });
});

describe('layer 2 — bucket names, caught at boot rather than on first upload', () => {
  it.each([
    ['UPPERCASE', 'Majalis-Elm-Media'],
    ['an underscore', 'majalis_elm_media'],
    ['a leading hyphen', '-majalis-elm'],
    ['a trailing dot', 'majalis-elm.'],
    ['too short', 'ab'],
    ['a space', 'majalis elm'],
    ['consecutive dots', 'majalis..elm'],
    ['an IPv4 address', '192.168.1.10'],
  ])('rejects a bucket name with %s', (_label, bucket) => {
    expect(() =>
      assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_BUCKET_NAME: bucket }),
    ).toThrow(/S3_BUCKET_NAME/);
  });

  it.each(['majalis-elm-media', 'majalis.elm.media', 'm3d1a'])(
    'accepts the valid bucket name %s',
    (bucket) => {
      expect(() =>
        assertStorageIntegrity({ ...GOOD_STORAGE, NODE_ENV: 'production', S3_BUCKET_NAME: bucket }),
      ).not.toThrow();
    },
  );
});

// ════ The guard has no off switch ═════════════════════════════════════════════

describe('no bypass exists', () => {
  it('ignores any env var that looks like a storage kill switch', () => {
    // If someone adds one later, this test is where it gets caught. Every name
    // here is a plausible thing a hurried developer would reach for.
    for (const bypass of [
      'STORAGE_DISABLED',
      'DISABLE_STORAGE',
      'SKIP_STORAGE_CHECK',
      'S3_OPTIONAL',
      'MEDIA_UPLOAD_DISABLED',
      'ALLOW_MISSING_STORAGE',
    ]) {
      expect(() =>
        assertStorageIntegrity({ NODE_ENV: 'production', [bypass]: 'true' } as never),
      ).toThrow(/refusing to start/);
    }
  });

  it('cannot be satisfied by NODE_ENV values that merely resemble test', () => {
    // 'test' is the one exempt value. Anything else — including a typo or a
    // CI-invented label — must take the full check, because the exemption is a
    // hole and holes must be exactly one value wide.
    for (const nodeEnv of ['Test', 'TEST', 'testing', 'test ', 'tests', 'e2e', 'ci']) {
      expect(() => assertStorageIntegrity({ NODE_ENV: nodeEnv })).toThrow(/refusing to start/);
    }
  });

  it('is called from main.ts before the Nest application is created', () => {
    // Order is the property under test: the guard must run before anything can
    // bind a port or serve a request, so a misconfigured server never has a
    // window in which it looks healthy.
    const main = require('fs').readFileSync(require.resolve('../../../main.ts'), 'utf8') as string;

    // Matched as statements, not as text: `NestFactory.create()` also appears in
    // a comment above the JWT guard, and a plain indexOf finds that first.
    const guardAt = /^\s*assertStorageIntegrity\(\);/m.exec(main)?.index;
    const createAt = /await\s+NestFactory\.create\(/.exec(main)?.index;

    expect(guardAt).toBeDefined();
    expect(createAt).toBeDefined();
    expect(guardAt as number).toBeLessThan(createAt as number);
  });
});
