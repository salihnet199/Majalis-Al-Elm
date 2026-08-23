/**
 * ensure-media-bucket.mjs — creates and locks down the local media bucket.
 *
 * ADR-013 Stage A. The backend refuses to boot unless HeadBucket succeeds
 * (s3-storage.adapter.ts `assertReachable`, layer 3 of the storage guard), so the
 * bucket has to exist before `nx serve backend`. This script is what creates it.
 *
 * Why a Node script rather than the `minio/mc` container this replaced: mc adds a
 * second image to pull for two API calls, and the pull is a hard dependency on
 * Docker Hub reachability — on a machine that cannot reach it, `docker compose up`
 * fails outright and local development is blocked. The AWS SDK is already a
 * dependency of this repo, speaks the same API, and works offline against the
 * MinIO container that is already running.
 *
 * It is idempotent: run it as often as you like.
 *
 *   node scripts/ensure-media-bucket.mjs
 *
 * Reads S3_* from the environment, falling back to .env.local, then .env.example
 * defaults. Refuses to run against anything but a local endpoint — see below.
 */

import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  GetBucketPolicyCommand,
  DeleteBucketPolicyCommand,
} = require('@aws-sdk/client-s3');

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

/** Minimal .env parser — enough for KEY=value lines, no interpolation. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const fileEnv = loadEnvFile(resolve(ROOT, '.env.local'));
const get = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

const endpoint = get('S3_ENDPOINT', 'http://localhost:9000');
const region = get('S3_REGION', 'us-east-1');
const bucket = get('S3_BUCKET_NAME', 'majalis-elm-media');
const accessKeyId = get('S3_ACCESS_KEY');
const secretAccessKey = get('S3_SECRET_KEY');

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!accessKeyId || !secretAccessKey) {
  die(
    'S3_ACCESS_KEY and S3_SECRET_KEY are required.\n' +
      '  Copy .env.example to .env.local and keep the local-dev values, or export them.',
  );
}

// This script CREATES buckets and REWRITES bucket policy. Those are not things to
// do by accident against production storage because a shell had the wrong .env
// exported, so it is restricted to a local endpoint. The production bucket on R2
// is created once, deliberately, in the Cloudflare dashboard.
let parsed;
try {
  parsed = new URL(endpoint);
} catch {
  die(`S3_ENDPOINT is not a valid URL: "${endpoint}"`);
}
const isLocal = ['localhost', '127.0.0.1', '::1', 'minio', '0.0.0.0'].includes(parsed.hostname);
if (!isLocal) {
  die(
    `Refusing to run against a non-local endpoint: ${endpoint}\n` +
      '  This script is for the local MinIO container only. Create the production\n' +
      '  bucket deliberately in the Cloudflare R2 dashboard, not from a dev script.',
  );
}

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const isNotFound = (error) =>
  error?.name === 'NotFound' ||
  error?.name === 'NoSuchBucket' ||
  error?.$metadata?.httpStatusCode === 404;

async function bucketExists() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    if (error?.$metadata?.httpStatusCode === 403) {
      die(
        `Storage rejected the credentials (403) at ${endpoint}.\n` +
          '  S3_ACCESS_KEY / S3_SECRET_KEY do not match MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.\n' +
          '  Both come from the same .env.local values, so restart the container after changing them:\n' +
          '    docker compose --env-file .env.local up -d --force-recreate minio',
      );
    }
    die(
      `Could not reach object storage at ${endpoint}\n` +
        `  ${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n` +
        '  Start it first:  docker compose --env-file .env.local up -d minio',
    );
  }
}

/**
 * Asserts the bucket is not anonymously readable.
 *
 * API-002 serves protected lectures through short-lived presigned URLs. A public
 * bucket would make every one of them downloadable by key forever, which is the
 * whole control defeated — so this does not merely skip setting a public policy,
 * it removes one if it finds one.
 */
async function assertNotPublic() {
  try {
    const current = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    const policy = current?.Policy ?? '';
    if (policy.includes('"Principal":{"AWS":["*"]}') || policy.includes('"Principal":"*"')) {
      console.log('  ! bucket had an anonymous-access policy — removing it');
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
    }
  } catch (error) {
    // No policy at all is the desired state; MinIO reports it as NoSuchBucketPolicy.
    if (
      error?.name !== 'NoSuchBucketPolicy' &&
      error?.Code !== 'NoSuchBucketPolicy' &&
      error?.$metadata?.httpStatusCode !== 404
    ) {
      throw error;
    }
  }
}

console.log(`\nObject storage bootstrap (ADR-013)\n  endpoint: ${endpoint}\n  bucket:   ${bucket}`);

if (await bucketExists()) {
  console.log('  · bucket already exists');
} else {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log('  + bucket created');
}

await assertNotPublic();

// Prove it, rather than assume the create succeeded. This is the same call the
// backend makes at boot, so a pass here means the server will start.
if (!(await bucketExists())) {
  die(`Bucket "${bucket}" still does not exist after creation — nothing was verified.`);
}

console.log('  ✓ verified with HeadBucket (anonymous access: none)\n');
