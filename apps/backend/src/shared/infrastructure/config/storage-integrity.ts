import { URL } from 'url';

/**
 * Storage configuration integrity — layer 2 of 3, POLICY-SEC-001 §3.
 *
 * ADR-013 requires an S3-compatible object store for all media. The sponsor's
 * Stage A decision (2026-08-22) is explicit: **the server must not boot without
 * real storage reachable — "لا تراجع صامت لحالة بلا رفع ملفات"**. There is
 * therefore no "storage disabled" mode anywhere in this codebase; a missing or
 * unsafe storage configuration is a boot failure.
 *
 * Three independent layers, each catching what the others structurally cannot:
 *
 *   1. `s3ConfigRequirementSchema` (app.config.ts) — the five S3_* vars must be
 *      present and well-formed outside NODE_ENV=test.
 *   2. `assertStorageIntegrity()` (this file, called from main.ts BEFORE
 *      NestFactory.create) — the *values* must be safe for the target
 *      environment: no publicly-known credentials, no cleartext transport, no
 *      loopback endpoint in production.
 *   3. `S3StorageAdapter.assertReachable()` (HeadBucket at boot) — the bucket
 *      must actually exist and answer to these credentials. Only a live network
 *      call can prove that; no amount of schema validation can.
 *
 * Why layer 2 cannot be folded into layer 1: Joi validates shapes, and every
 * check here is a *semantic* judgement about a value that is perfectly
 * well-formed. `minioadmin` is a valid string; `http://localhost:9000` is a
 * valid URI. They are simply catastrophic in production. This is the same
 * lesson as TECH-DEBT-013, where the test-only JWT secret was a valid string
 * too — and the same lesson again about NODE_ENV: it is a deployment label, not
 * a security boundary, so the dangerous values are named and rejected
 * explicitly rather than assumed absent.
 */

/**
 * Credentials that ship with MinIO/S3 tooling or appear verbatim in vendor
 * documentation. They are public knowledge, so they secure nothing. Fine for a
 * laptop; a full media-bucket compromise in production.
 */
export const WELL_KNOWN_STORAGE_CREDENTIALS: readonly string[] = [
  'minioadmin',        // MinIO factory default (both key and secret)
  'minio',
  'minio123',
  'minioadmin123',
  'access_key',
  'secret_key',
  'accesskey',
  'secretkey',
  'AKIAIOSFODNN7EXAMPLE',                      // AWS documentation example key
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',  // AWS documentation example secret
  'changeme',
  'password',
  'test',
];

/** Placeholder markers left behind when someone copies .env.example verbatim. */
const PLACEHOLDER_MARKERS: readonly string[] = [
  '<replace',
  'your-',
  'xxx',
  'todo',
  'changeme',
  // Carried by the credentials in .env.example on purpose, so that copying that
  // file onto a server is a boot failure rather than a bucket guarded by a value
  // published in the repository.
  'local-dev-only',
];

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'];

/** S3 bucket naming rules (also enforced by every S3-compatible vendor). */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface StorageEnv {
  NODE_ENV?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
  /** Optional. Only set when the browser's address differs from the server's. */
  S3_PUBLIC_BASE_URL?: string;
}

function isPlaceholder(value: string): boolean {
  const lowered = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

function isWellKnown(value: string): boolean {
  return WELL_KNOWN_STORAGE_CREDENTIALS.some(
    (known) => known.toLowerCase() === value.trim().toLowerCase(),
  );
}

/**
 * Shared checks for both storage URLs. S3_PUBLIC_BASE_URL is the host presigned
 * URLs are signed against, so an unsafe value there is exactly as dangerous as
 * an unsafe S3_ENDPOINT — it is the address the editor's browser is told to send
 * media bytes to.
 */
function checkStorageUrl(
  varName: string,
  raw: string,
  opts: { isHardened: boolean; nodeEnv: string; problems: string[] },
): void {
  const { isHardened, nodeEnv, problems } = opts;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    problems.push(`${varName} is not a valid absolute URL (got "${raw}")`);
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    problems.push(`${varName} must use http or https (got "${parsed.protocol}")`);
  }

  // SigV4 protects the signature, NOT the payload. Over plain HTTP the media
  // bytes and the presigned URL both travel in the clear, and the presigned URL
  // is a bearer credential: anyone who observes it can replay it until it
  // expires. Acceptable on a laptop, never across a real network.
  if (isHardened && parsed.protocol !== 'https:') {
    problems.push(
      `${varName} must use https under NODE_ENV=${nodeEnv} — presigned URLs are bearer ` +
        'credentials and must not travel over cleartext HTTP',
    );
  }

  if (isHardened && LOOPBACK_HOSTS.includes(parsed.hostname.toLowerCase())) {
    problems.push(
      `${varName} points at the loopback host "${parsed.hostname}" under ` +
        `NODE_ENV=${nodeEnv} — this is a development endpoint reaching a deployed environment`,
    );
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    // A path here silently corrupts every key: the SDK would prefix it to the
    // bucket, so objects land somewhere other than where the DB says they are.
    problems.push(
      `${varName} must not contain a path (got "${parsed.pathname}") — ` +
        'the bucket comes from S3_BUCKET_NAME',
    );
  }

  if (parsed.username || parsed.password) {
    problems.push(`${varName} must not embed credentials — use S3_ACCESS_KEY / S3_SECRET_KEY`);
  }
}

/**
 * Refuses to boot when the object-storage configuration is missing or unsafe.
 *
 * Skipped only under an explicit `NODE_ENV=test`, where the suite injects its
 * own adapter configuration. An UNSET NODE_ENV counts as `development` — i.e.
 * storage IS required — so the fail-safe direction is "demand configuration",
 * never "assume tests".
 *
 * @throws Error listing every problem found, not just the first.
 */
export function assertStorageIntegrity(env: StorageEnv = process.env as StorageEnv): void {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'test') return;

  const isHardened = nodeEnv === 'production' || nodeEnv === 'staging';
  const problems: string[] = [];

  const endpoint = env.S3_ENDPOINT?.trim() ?? '';
  const accessKey = env.S3_ACCESS_KEY?.trim() ?? '';
  const secretKey = env.S3_SECRET_KEY?.trim() ?? '';
  const bucket = env.S3_BUCKET_NAME?.trim() ?? '';
  const region = env.S3_REGION?.trim() ?? '';
  const publicBaseUrl = env.S3_PUBLIC_BASE_URL?.trim() ?? '';

  // ── Presence ───────────────────────────────────────────────────────────────
  if (!endpoint) problems.push('S3_ENDPOINT is missing');
  if (!accessKey) problems.push('S3_ACCESS_KEY is missing');
  if (!secretKey) problems.push('S3_SECRET_KEY is missing');
  if (!bucket) problems.push('S3_BUCKET_NAME is missing');
  if (!region) problems.push('S3_REGION is missing');

  // ── URL shape and transport ────────────────────────────────────────────────
  if (endpoint) {
    checkStorageUrl('S3_ENDPOINT', endpoint, { isHardened, nodeEnv, problems });
  }

  // Optional, and only meaningful when the browser's address differs from the
  // server's (local Docker). Held to the same standard when present, because it
  // is the host the editor's browser is told to upload to.
  if (publicBaseUrl) {
    checkStorageUrl('S3_PUBLIC_BASE_URL', publicBaseUrl, { isHardened, nodeEnv, problems });
  }

  // ── Credential quality ─────────────────────────────────────────────────────
  // Named-and-rejected, exactly as TEST_ONLY_JWT_SECRET is. A well-known
  // credential in production is indistinguishable from no credential at all.
  if (isHardened) {
    if (accessKey && isWellKnown(accessKey)) {
      problems.push(
        `S3_ACCESS_KEY is a well-known default credential ("${accessKey}") and must never be ` +
          `used under NODE_ENV=${nodeEnv} — it is published in vendor documentation`,
      );
    }
    if (secretKey && isWellKnown(secretKey)) {
      problems.push(
        `S3_SECRET_KEY is a well-known default credential and must never be used under ` +
          `NODE_ENV=${nodeEnv} — it is published in vendor documentation`,
      );
    }
    if (accessKey && isPlaceholder(accessKey)) {
      problems.push('S3_ACCESS_KEY still contains a placeholder value from .env.example');
    }
    if (secretKey && isPlaceholder(secretKey)) {
      problems.push('S3_SECRET_KEY still contains a placeholder value from .env.example');
    }
    if (secretKey && secretKey.length < 16) {
      problems.push(
        `S3_SECRET_KEY is only ${secretKey.length} characters — an object-store secret guarding ` +
          'all platform media must be at least 16',
      );
    }
  }

  // ── Bucket name ────────────────────────────────────────────────────────────
  // Caught at boot instead of on the first editor upload: a bucket typo would
  // otherwise surface as a runtime 404 in front of a user.
  if (bucket) {
    if (!BUCKET_NAME_PATTERN.test(bucket)) {
      problems.push(
        `S3_BUCKET_NAME "${bucket}" is not a valid S3 bucket name — 3-63 characters, lowercase ` +
          'letters, digits, dots and hyphens only, starting and ending with a letter or digit',
      );
    } else if (bucket.includes('..')) {
      problems.push(`S3_BUCKET_NAME "${bucket}" must not contain consecutive dots`);
    } else if (IPV4_PATTERN.test(bucket)) {
      problems.push(`S3_BUCKET_NAME "${bucket}" must not be formatted as an IP address`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Object storage configuration is invalid — refusing to start (ADR-013 / POLICY-SEC-001):\n` +
        problems.map((p) => `  • ${p}`).join('\n') +
        `\n\nMedia upload is not an optional feature of this platform; there is no ` +
        `"storage disabled" mode to fall back to. Configure S3_ENDPOINT, S3_ACCESS_KEY, ` +
        `S3_SECRET_KEY, S3_BUCKET_NAME and S3_REGION. For local development run ` +
        `\`docker compose up minio\` and copy the S3 block from .env.example.`,
    );
  }
}
