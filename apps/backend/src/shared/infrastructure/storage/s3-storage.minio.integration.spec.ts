/**
 * S3StorageAdapter — integration test against a REAL MinIO instance.
 *
 * This is the proof the sponsor asked for on 2026-08-22, in his order:
 * upload → headObject verification → download → SHA-256 match. Everything else in
 * this repository tests the upload flow against a fake; this file tests it against
 * the actual object store, over real HTTP, using the presigned URLs the adapter
 * signs. A mock cannot tell us that SigV4 signing is correct, that MinIO enforces
 * the checksum header, or that the signed Content-Length is honoured — only this
 * can.
 *
 * ── Not part of the default test run ────────────────────────────────────────
 * `jest.config.cts` excludes `*.minio.integration.spec.ts`, because it needs
 * infrastructure. Run it deliberately:
 *
 *     docker compose --env-file .env.local up -d minio
 *     node scripts/ensure-media-bucket.mjs
 *     npx nx run backend:test-storage
 *
 * ── It fails; it never skips ─────────────────────────────────────────────────
 * If MinIO is unreachable or misconfigured, every test here FAILS with a loud
 * diagnosis. It does not `it.skip`, and it does not pass with a warning. A suite
 * whose job is to prove that storage works, and which reports green when it never
 * reached storage, is POLICY-SEC-001 category 4 (fabricated readiness) wearing a
 * test suite's clothes — the precise failure mode the code under test exists to
 * remove. Green here always means: bytes really moved.
 */

import { createHash, randomUUID } from 'crypto';
import {
  S3StorageAdapter,
  S3StorageConfig,
} from './s3-storage.adapter';
import { CompletedPart } from '../../../modules/content/domain/ports/storage.service';
import {
  MAX_SINGLE_PUT_BYTES,
  buildOriginalKey,
  sha256HexToBase64,
} from '../../../modules/content/domain/media-upload.policy';
import { envReader } from '../../../testing/env-local';

// ── Configuration ──────────────────────────────────────────────────────────────
// Read from the environment, falling back to .env.local (which jest does not
// load). Nothing is defaulted to a placeholder: a missing credential fails the
// suite rather than quietly testing against something else.

const env = envReader();

const SETUP_HINT =
  '\n\nThis suite requires a running MinIO with the media bucket created:\n' +
  '  docker compose --env-file .env.local up -d minio\n' +
  '  node scripts/ensure-media-bucket.mjs\n';

const endpoint = env('S3_ENDPOINT', 'http://localhost:9000') as string;
const bucket = env('S3_BUCKET_NAME', 'majalis-elm-media') as string;
const region = env('S3_REGION', 'us-east-1') as string;
const accessKeyId = env('S3_ACCESS_KEY');
const secretAccessKey = env('S3_SECRET_KEY');

/**
 * Presigned URLs are signed against the endpoint's host, so the test client must
 * use the same address the adapter signed for. Inside a container that is
 * `http://minio:9000`; from the host it is localhost. Here they are the same.
 */
const config: S3StorageConfig = {
  endpoint,
  publicEndpoint: endpoint,
  region,
  accessKeyId: accessKeyId as string,
  secretAccessKey: secretAccessKey as string,
  bucket,
  forcePathStyle: true,
};

/** Keys written by this run, removed in afterAll. */
const writtenKeys: string[] = [];

function makeKey(sha256: string, extension = 'mp3'): string {
  const key = buildOriginalKey({ mediaId: randomUUID(), sha256, extension });
  writtenKeys.push(key);
  return key;
}

/** PUTs a body to a presigned URL with exactly the headers the signature covers. */
async function putSigned(
  url: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<Response> {
  // Content-Length is set by the HTTP stack from the body itself and cannot be
  // overridden here — which is the point of signing it: the client cannot claim
  // one length and send another.
  const { 'Content-Length': _signedLength, ...sendable } = headers;
  return fetch(url, { method: 'PUT', headers: sendable, body: new Uint8Array(body) });
}

describe('S3StorageAdapter — real MinIO integration (ADR-013 Stage A)', () => {
  let storage: S3StorageAdapter;

  beforeAll(async () => {
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3_ACCESS_KEY and S3_SECRET_KEY are not set, so this suite cannot reach real ' +
          'storage. Refusing to run: a storage integration test that passes without ' +
          'credentials proves nothing.' +
          SETUP_HINT,
      );
    }

    storage = new S3StorageAdapter(config);

    // Prove the target exists BEFORE any test asserts anything about it, and fail
    // the whole suite with a usable message if it does not.
    try {
      await storage.assertReachable();
    } catch (error) {
      throw new Error(
        `Cannot reach MinIO at ${endpoint} (bucket "${bucket}").\n` +
          `${(error as Error).message}` +
          SETUP_HINT,
      );
    }
  }, 30_000);

  afterAll(async () => {
    // Best-effort cleanup. A failure to delete is reported, never swallowed, but
    // it must not mask the result of the tests themselves.
    for (const key of writtenKeys) {
      try {
        await storage?.deleteObject(key);
      } catch (error) {
        console.warn(`Cleanup failed for ${key}: ${(error as Error).message}`);
      }
    }
  }, 60_000);

  // ══ The sponsor's sequence: upload → head → download → SHA-256 match ════════

  it(
    'single PUT: uploads through a presigned URL, verifies with headObject, downloads, ' +
      'and the SHA-256 of the retrieved bytes matches the original',
    async () => {
      // 1. A real file's bytes and their real digest.
      const body = Buffer.from(
        `مجالس العلم — presigned upload integration test ${randomUUID()}\n`.repeat(64),
        'utf8',
      );
      const sha256 = createHash('sha256').update(body).digest('hex');
      const key = makeKey(sha256);

      // 2. Sign the upload. This is exactly what /admin/media/upload/initiate does.
      const presigned = await storage.presignUpload({
        key,
        contentType: 'audio/mpeg',
        contentLength: body.length,
        sha256Hex: sha256,
        ttlSeconds: 300,
      });

      expect(presigned.url).toContain('X-Amz-Signature=');
      expect(presigned.url).toContain('X-Amz-SignedHeaders=');
      expect(presigned.requiredHeaders['x-amz-checksum-sha256']).toBe(sha256HexToBase64(sha256));

      // 3. Upload the bytes directly to storage — never through NestJS (ADR-013 §3).
      const putRes = await putSigned(presigned.url, presigned.requiredHeaders, body);
      if (!putRes.ok) {
        throw new Error(
          `Presigned PUT failed: ${putRes.status} ${putRes.statusText}\n${await putRes.text()}`,
        );
      }
      expect(putRes.status).toBe(200);

      // 4. headObject — the authoritative check `complete` relies on.
      const head = await storage.head(key);
      expect(head).not.toBeNull();
      expect(head?.sizeBytes).toBe(body.length);
      expect(head?.contentType).toBe('audio/mpeg');
      expect(head?.etag).toBeTruthy();
      // MinIO recorded the checksum we signed, and it is the one we declared.
      expect(head?.checksumSha256).toBe(sha256HexToBase64(sha256));

      // 5. Download through a presigned GET (API-002) and hash what comes back.
      const download = await storage.presignDownload({
        key,
        ttlSeconds: 300,
        downloadFilename: 'درس-الفرائض.mp3',
      });
      const getRes = await fetch(download.url);
      expect(getRes.status).toBe(200);
      const downloaded = Buffer.from(await getRes.arrayBuffer());

      // 6. The whole point: the bytes that came back are the bytes that went in.
      expect(downloaded.length).toBe(body.length);
      expect(createHash('sha256').update(downloaded).digest('hex')).toBe(sha256);
      expect(downloaded.equals(body)).toBe(true);

      // The download URL also carries the Arabic filename safely.
      expect(getRes.headers.get('content-disposition')).toContain('UTF-8');
    },
    120_000,
  );

  // ══ The controls are enforced by STORAGE, not by our trust in the client ════

  it('storage rejects a body whose SHA-256 differs from the signed checksum', async () => {
    const declared = Buffer.from('the file that was announced', 'utf8');
    const sha256 = createHash('sha256').update(declared).digest('hex');
    const key = makeKey(sha256);

    const presigned = await storage.presignUpload({
      key,
      contentType: 'audio/mpeg',
      contentLength: declared.length,
      sha256Hex: sha256,
      ttlSeconds: 300,
    });

    // Same length, different bytes — so only the checksum can catch it.
    const tampered = Buffer.alloc(declared.length, 0x41);
    expect(tampered.length).toBe(declared.length);

    const res = await putSigned(presigned.url, presigned.requiredHeaders, tampered);

    // MinIO recomputes SHA-256 over the received body and refuses the write. This
    // is what makes the content-addressed key a verified fact rather than a claim.
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    // And nothing was stored, so `complete` would abort the asset.
    expect(await storage.head(key)).toBeNull();
  }, 60_000);

  it('storage rejects a body of a different length than was signed', async () => {
    const body = Buffer.from('exactly these bytes', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = makeKey(sha256);

    const presigned = await storage.presignUpload({
      key,
      contentType: 'audio/mpeg',
      contentLength: body.length,
      sha256Hex: sha256,
      ttlSeconds: 300,
    });

    const res = await putSigned(
      presigned.url,
      presigned.requiredHeaders,
      Buffer.concat([body, Buffer.from('extra')]),
    );

    expect(res.ok).toBe(false);
    expect(await storage.head(key)).toBeNull();
  }, 60_000);

  it('storage rejects an upload with a content type other than the one signed', async () => {
    const body = Buffer.from('<html>not audio</html>', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = makeKey(sha256);

    const presigned = await storage.presignUpload({
      key,
      contentType: 'audio/mpeg',
      contentLength: body.length,
      sha256Hex: sha256,
      ttlSeconds: 300,
    });

    const res = await putSigned(
      presigned.url,
      { ...presigned.requiredHeaders, 'Content-Type': 'text/html' },
      body,
    );

    expect(res.ok).toBe(false);
    expect(await storage.head(key)).toBeNull();
  }, 60_000);

  it('an expired upload URL is refused', async () => {
    const body = Buffer.from('too late', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = makeKey(sha256);

    // 1-second TTL, then wait it out. A presigned PUT is a bearer credential for
    // writing to the bucket; that it actually expires is a security property.
    const presigned = await storage.presignUpload({
      key,
      contentType: 'audio/mpeg',
      contentLength: body.length,
      sha256Hex: sha256,
      ttlSeconds: 1,
    });

    await new Promise((r) => setTimeout(r, 2500));
    const res = await putSigned(presigned.url, presigned.requiredHeaders, body);

    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(await storage.head(key)).toBeNull();
  }, 60_000);

  it('an object is not readable without a signature', async () => {
    const body = Buffer.from('protected lecture content', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = makeKey(sha256);

    const presigned = await storage.presignUpload({
      key,
      contentType: 'audio/mpeg',
      contentLength: body.length,
      sha256Hex: sha256,
      ttlSeconds: 300,
    });
    const put = await putSigned(presigned.url, presigned.requiredHeaders, body);
    expect(put.ok).toBe(true);

    // The bucket must not be anonymously readable: API-002 is only a control if
    // the underlying object cannot be fetched by key alone.
    const anonymous = await fetch(`${endpoint}/${bucket}/${key}`);
    expect(anonymous.ok).toBe(false);
    expect([401, 403]).toContain(anonymous.status);
  }, 60_000);

  it('head() returns null for a key that was never written', async () => {
    // The distinction the whole verification path rests on: provably absent, as
    // opposed to an error. `complete` turns this null into an ABORTED asset.
    const absent = buildOriginalKey({
      mediaId: randomUUID(),
      sha256: createHash('sha256').update('never uploaded').digest('hex'),
      extension: 'mp3',
    });
    expect(await storage.head(absent)).toBeNull();
  }, 30_000);

  it('deleteObject removes the object, and head() then reports it absent', async () => {
    const body = Buffer.from('temporary', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = makeKey(sha256);

    const presigned = await storage.presignUpload({
      key,
      contentType: 'audio/mpeg',
      contentLength: body.length,
      sha256Hex: sha256,
      ttlSeconds: 300,
    });
    expect((await putSigned(presigned.url, presigned.requiredHeaders, body)).ok).toBe(true);
    expect(await storage.head(key)).not.toBeNull();

    await storage.deleteObject(key);
    expect(await storage.head(key)).toBeNull();
  }, 60_000);

  // ══ Multipart: the >100MB path, end to end ══════════════════════════════════

  it(
    'multipart: uploads a file above the single-PUT limit part by part, assembles it, ' +
      'and the downloaded bytes hash to the original SHA-256',
    async () => {
      // Just over the 100MB single-PUT threshold, so this takes the multipart path
      // exactly as a real 100MB+ lecture recording would. Deterministic content, so
      // a mismatch is a real corruption and not test flakiness.
      const totalBytes = MAX_SINGLE_PUT_BYTES + 1024;
      const body = Buffer.alloc(totalBytes);
      for (let i = 0; i < totalBytes; i++) body[i] = (i * 31 + 7) & 0xff;
      const sha256 = createHash('sha256').update(body).digest('hex');
      const key = makeKey(sha256);

      const ticket = await storage.initiateMultipart({
        key,
        contentType: 'audio/mpeg',
        totalBytes,
        ttlSeconds: 3600,
      });

      expect(ticket.uploadId).toBeTruthy();
      expect(ticket.parts.length).toBeGreaterThan(1);
      // Every part except the last is a full part; the last holds the remainder.
      expect(ticket.parts.reduce((sum, p) => sum + p.contentLength, 0)).toBe(totalBytes);

      // Upload each part to its own presigned URL and keep the ETag storage
      // returns. The client cannot invent these: CompleteMultipartUpload fails if
      // any ETag does not match what storage recorded for that part.
      const completed: CompletedPart[] = [];
      let offset = 0;
      for (const part of ticket.parts) {
        const slice = body.subarray(offset, offset + part.contentLength);
        offset += part.contentLength;

        const res = await fetch(part.url, { method: 'PUT', body: new Uint8Array(slice) });
        if (!res.ok) {
          await storage.abortMultipart({ key, uploadId: ticket.uploadId });
          throw new Error(
            `Part ${part.partNumber} failed: ${res.status} ${res.statusText}\n${await res.text()}`,
          );
        }
        const etag = res.headers.get('etag');
        expect(etag).toBeTruthy();
        completed.push({ partNumber: part.partNumber, etag: etag as string });
      }
      expect(offset).toBe(totalBytes);

      // Before assembly, there is no object at the key — which is why the fake's
      // completeMultipart deliberately creates none either.
      expect(await storage.head(key)).toBeNull();

      await storage.completeMultipart({ key, uploadId: ticket.uploadId, parts: completed });

      // headObject now sees the assembled object at its full length.
      const head = await storage.head(key);
      expect(head).not.toBeNull();
      expect(head?.sizeBytes).toBe(totalBytes);

      // Honest limitation, stated in code as well as in the report: for a
      // multipart object S3/MinIO records a checksum of the part checksums, not a
      // whole-file SHA-256 (FULL_OBJECT checksums cover CRC32/CRC32C/CRC64NVME,
      // not SHA-256). The adapter therefore reports null rather than passing that
      // composite off as the file's digest — if it did, `complete` would reject
      // this perfectly valid upload with UPLOAD_CHECKSUM_MISMATCH.
      expect(head?.checksumSha256).toBeNull();

      // So the size is storage-enforced, and the SHA-256 is verified here by
      // reading the bytes back — not by the bucket.
      const download = await storage.presignDownload({ key, ttlSeconds: 300 });
      const getRes = await fetch(download.url);
      expect(getRes.status).toBe(200);
      const downloaded = Buffer.from(await getRes.arrayBuffer());

      expect(downloaded.length).toBe(totalBytes);
      expect(createHash('sha256').update(downloaded).digest('hex')).toBe(sha256);
    },
    600_000,
  );

  it('abortMultipart discards the session, leaving no object behind', async () => {
    const totalBytes = MAX_SINGLE_PUT_BYTES + 1024;
    const key = buildOriginalKey({
      mediaId: randomUUID(),
      sha256: createHash('sha256').update('aborted upload').digest('hex'),
      extension: 'mp3',
    });

    const ticket = await storage.initiateMultipart({
      key,
      contentType: 'audio/mpeg',
      totalBytes,
      ttlSeconds: 600,
    });

    // Upload one real part, then give up — the abandoned-upload case that
    // otherwise accrues billable parts nothing references.
    const slice = Buffer.alloc(ticket.parts[0].contentLength, 0x5a);
    const partRes = await fetch(ticket.parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(slice),
    });
    expect(partRes.ok).toBe(true);

    await storage.abortMultipart({ key, uploadId: ticket.uploadId });

    expect(await storage.head(key)).toBeNull();
    // Completing an aborted session must fail — there is nothing to assemble.
    await expect(
      storage.completeMultipart({
        key,
        uploadId: ticket.uploadId,
        parts: [{ partNumber: 1, etag: partRes.headers.get('etag') as string }],
      }),
    ).rejects.toThrow();
  }, 300_000);

  it('completeMultipart fails on an ETag the client made up', async () => {
    const totalBytes = MAX_SINGLE_PUT_BYTES + 1024;
    const key = buildOriginalKey({
      mediaId: randomUUID(),
      sha256: createHash('sha256').update('invented etags').digest('hex'),
      extension: 'mp3',
    });

    const ticket = await storage.initiateMultipart({
      key,
      contentType: 'audio/mpeg',
      totalBytes,
      ttlSeconds: 600,
    });

    try {
      await expect(
        storage.completeMultipart({
          key,
          uploadId: ticket.uploadId,
          parts: ticket.parts.map((p) => ({
            partNumber: p.partNumber,
            etag: '"00000000000000000000000000000000"',
          })),
        }),
      ).rejects.toThrow();

      expect(await storage.head(key)).toBeNull();
    } finally {
      await storage.abortMultipart({ key, uploadId: ticket.uploadId }).catch(() => undefined);
    }
  }, 300_000);

  // ══ The boot-time guard, against the real service ═══════════════════════════

  it('assertReachable fails loudly for a bucket that does not exist', async () => {
    const wrong = new S3StorageAdapter({ ...config, bucket: `no-such-bucket-${randomUUID()}` });

    // The message must be actionable: this is what a developer sees instead of a
    // server that started without upload capability.
    await expect(wrong.assertReachable()).rejects.toThrow(/refusing to start/i);
    await expect(wrong.assertReachable()).rejects.toThrow(/does not exist|not reachable/i);
  }, 60_000);

  it('assertReachable fails loudly for rejected credentials', async () => {
    const wrong = new S3StorageAdapter({
      ...config,
      accessKeyId: 'definitely-not-the-key',
      secretAccessKey: 'definitely-not-the-secret',
    });

    await expect(wrong.assertReachable()).rejects.toThrow(/refusing to start/i);
  }, 60_000);
});
