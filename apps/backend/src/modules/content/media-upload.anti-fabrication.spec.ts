/**
 * Media upload — anti-fabrication regression suite (POLICY-SEC-001).
 *
 * This file exists because of a specific defect, not as generic coverage. The
 * endpoint this code replaced did the following (TECH-DEBT-014):
 *
 *   • `POST /admin/media/upload/complete` called `MediaAsset.markDone()` on the
 *     strength of a request body. No byte was ever checked. The asset was then
 *     reported with `transcodeStatus: 'DONE'` — a claim that a media pipeline had
 *     processed a file that, in fact, was never uploaded and never existed.
 *   • `POST /admin/media/upload/initiate` returned `presignedUrl: null` while
 *     answering 200, and attributed the upload to a hard-coded UUID whenever the
 *     request carried no authenticated user.
 *
 * Categories 3 (fabricated success), 4 (fabricated readiness) and 1 (fabricated
 * identity) of POLICY-SEC-001, in one endpoint.
 *
 * Every test below is therefore adversarial: it drives the API the way a client
 * that lies, gives up, or is simply unlucky would drive it, and asserts that the
 * server's answer stays true. The single rule the whole suite exists to enforce:
 *
 *   AN ASSET REACHES `UPLOADED` ONLY AFTER STORAGE HAS BEEN ASKED AND HAS
 *   CONFIRMED AN OBJECT OF THE DECLARED SIZE — AND `transcodeStatus` IS NEVER
 *   `DONE`, BECAUSE ADR-013 STAGE B DOES NOT EXIST.
 *
 * `FakeStorageService` is what makes this testable: an object appears in it only
 * when a test explicitly calls `putObject()`. Nothing in the request path can
 * create one. So "the client said done and the bucket is empty" — the exact case
 * the old code could not distinguish from success — is one line to reproduce.
 */

import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import request = require('supertest');

import { JwtRs256Adapter } from '../identity/infrastructure/adapters/jwt-rs256.adapter';
import { JwtStrategy } from '../identity/infrastructure/adapters/jwt.strategy';
import { UUIDv7 } from '../../shared/domain/uuid.vo';
import { MediaAsset } from './domain/media-asset.entity';
import {
  IMediaAssetRepository,
  MEDIA_ASSET_REPOSITORY,
} from './domain/ports/media-asset.repository';
import { STORAGE_SERVICE } from './domain/ports/storage.service';
import { MAX_SINGLE_PUT_BYTES } from './domain/media-upload.policy';
import { MediaUploadService } from './application/services/media-upload.service';
import { AdminMediaController } from './presentation/admin-media.controller';
import { RolesGuard } from './presentation/guards/roles.guard';
import { FakeStorageService } from './testing/fake-storage.service';

import { GlobalExceptionFilter } from '../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../shared/presentation/interceptors/trace-id.interceptor';

class BypassThrottlerGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('Media upload — anti-fabrication regression suite (POLICY-SEC-001)', () => {
  let app: INestApplication;
  let jwtAdapter: JwtRs256Adapter;
  let editorToken: string;
  let editorId: string;

  let assets: MediaAsset[] = [];
  const storage = new FakeStorageService();

  /** Reads the row straight out of the store — the API's answer is not the source. */
  const row = (id: string) => assets.find((a) => a.id.value === id);

  const initiate = (body: Record<string, unknown>, token = editorToken) =>
    request(app.getHttpServer())
      .post('/admin/media/upload/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const complete = (body: Record<string, unknown>, token = editorToken) =>
    request(app.getHttpServer())
      .post('/admin/media/upload/complete')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const status = (id: string, token = editorToken) =>
    request(app.getHttpServer())
      .get(`/admin/media/${id}/status`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'jwt.accessTokenTtl': 900,
          'jwt.refreshTokenTtl': 604800,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const mockMediaRepo: IMediaAssetRepository = {
      async findById(id: string): Promise<MediaAsset | null> {
        return assets.find((a) => a.id.value === id && !a.deletedAt) ?? null;
      },
      async save(asset: MediaAsset): Promise<MediaAsset> {
        assets.push(asset);
        return asset;
      },
      async update(asset: MediaAsset): Promise<MediaAsset> {
        const index = assets.findIndex((a) => a.id.value === asset.id.value);
        if (index !== -1) assets[index] = asset;
        return asset;
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
      controllers: [AdminMediaController],
      providers: [
        RolesGuard,
        JwtStrategy,
        JwtRs256Adapter,
        MediaUploadService,
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MEDIA_ASSET_REPOSITORY, useValue: mockMediaRepo },
        { provide: APP_GUARD, useClass: BypassThrottlerGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());
    await app.init();

    jwtAdapter = moduleFixture.get<JwtRs256Adapter>(JwtRs256Adapter);
    editorId = randomUUID();
    editorToken = await jwtAdapter.signAccessToken({
      sub: editorId,
      email: 'editor@example.com',
      role: 'Editor',
      sessionId: randomUUID(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    assets = [];
    storage.reset();
  });

  /** A valid single-part initiate, plus the bytes that would satisfy it. */
  async function initiateSingle(overrides: Partial<Record<string, unknown>> = {}) {
    const body = Buffer.from(`payload ${randomUUID()}`, 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const res = await initiate({
      fileName: 'lecture.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: body.length,
      sha256,
      ...overrides,
    }).expect(200);
    return { body, sha256, ...res.body.data };
  }

  // ══ 1. The defect itself ════════════════════════════════════════════════════

  it('refuses to complete an upload that never happened, and records the truth', async () => {
    const { uploadId, storageKey } = await initiateSingle();

    // The bucket is empty. This is the request the old endpoint answered 200 to.
    expect(storage.keys()).toHaveLength(0);

    const res = await complete({ uploadId }).expect(409);

    expect(res.body.error.code).toBe('UPLOAD_NOT_FOUND_IN_STORAGE');
    expect(res.body.data).toBeUndefined();
    // Storage really was consulted; the refusal is not a guess.
    expect(storage.calls).toContain(`head:${storageKey}`);

    // The row must not be UPLOADED, and must carry the reason.
    const asset = row(uploadId);
    expect(asset?.uploadStatus).toBe('ABORTED');
    expect(asset?.isUploaded).toBe(false);
    expect(asset?.verifiedBytes).toBeNull();
    expect(asset?.uploadedAt).toBeNull();
    expect(asset?.uploadError).toMatch(/no object|never uploaded/i);

    // And `/status` keeps telling the truth afterwards — no fabricated success
    // anywhere in the read path either.
    const st = await status(uploadId).expect(200);
    expect(st.body.data.uploadStatus).toBe('ABORTED');
    expect(st.body.data.verifiedBytes).toBeNull();
    expect(st.body.data.transcodeStatus).toBe('PENDING');
    expect(st.body.data.uploadError).toBeTruthy();
  });

  it('never reports transcodeStatus DONE — not on success, not anywhere', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();
    storage.putObject(storageKey, body, 'audio/mpeg');

    const res = await complete({ uploadId }).expect(200);

    // The upload genuinely succeeded — and still says PENDING, because Stage B
    // (BullMQ + ffmpeg/sharp) is not implemented. This assertion is the inverse
    // of the one the stub shipped with.
    expect(res.body.data.uploadStatus).toBe('UPLOADED');
    expect(res.body.data.transcodeStatus).toBe('PENDING');
    expect(res.body.data.transcodeStatus).not.toBe('DONE');
    expect(JSON.stringify(res.body)).not.toContain('"DONE"');

    const st = await status(uploadId).expect(200);
    expect(st.body.data.transcodeStatus).toBe('PENDING');
    expect(st.body.data.transcodeError).toBeNull();
    expect(row(uploadId)?.transcodeStatus).toBe('PENDING');
  });

  it('exposes no domain method capable of fabricating a finished transcode', () => {
    // `markDone()` was deleted, not left unused. An available method that
    // fabricates completion is how the last defect happened; a future caller
    // must not be able to find one.
    const proto = MediaAsset.prototype as unknown as Record<string, unknown>;
    expect(proto['markDone']).toBeUndefined();
    expect(proto['markFailed']).toBeUndefined();
    expect(Object.getOwnPropertyNames(MediaAsset.prototype)).not.toContain('markDone');
  });

  // ══ 2. Wrong bytes, right story ═════════════════════════════════════════════

  it('refuses a truncated upload and reports both byte counts', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();

    // The client uploaded fewer bytes than it declared — a dropped connection.
    storage.putObjectOfSize(storageKey, body.length - 5, 'audio/mpeg');

    const res = await complete({ uploadId }).expect(409);

    expect(res.body.error.code).toBe('UPLOAD_SIZE_MISMATCH');
    // The diagnostic survives the exception filter: an editor must be able to see
    // what storage holds versus what was promised.
    expect(res.body.error.details[0]).toEqual({
      verifiedBytes: body.length - 5,
      declaredBytes: body.length,
    });
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');
    expect(row(uploadId)?.isUploaded).toBe(false);
  });

  it('refuses an object of the right size whose bytes are not the declared file', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();

    // Exactly the promised length, entirely different content. Size alone would
    // have passed; the checksum is what catches it.
    storage.putObject(storageKey, Buffer.alloc(body.length, 0x41), 'audio/mpeg');

    const res = await complete({ uploadId }).expect(409);

    expect(res.body.error.code).toBe('UPLOAD_CHECKSUM_MISMATCH');
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');
    expect(row(uploadId)?.verifiedBytes).toBeNull();
  });

  // ══ 3. Inconclusive is not a verdict ════════════════════════════════════════

  it('treats an unreachable storage check as an error, not as absence and not as success', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();
    // The bytes ARE there. Storage just cannot be asked right now.
    storage.putObject(storageKey, body, 'audio/mpeg');
    storage.headError = Object.assign(new Error('403 Forbidden from storage'), {
      name: 'AccessDenied',
    });

    const res = await complete({ uploadId }).expect(500);

    // Not 409: we do not know that the object is missing. Not 200: we do not
    // know that it is there. The client is told the check failed.
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    // P-07: the storage error text never reaches the client.
    expect(JSON.stringify(res.body)).not.toContain('403 Forbidden from storage');

    // Crucially, the row is untouched — a good upload must not be destroyed by a
    // failed lookup, and must not be confirmed by one either.
    const asset = row(uploadId);
    expect(asset?.uploadStatus).toBe('PENDING_UPLOAD');
    expect(asset?.isUploaded).toBe(false);
    expect(asset?.uploadError).toBeNull();

    // Once storage answers again, the same upload completes honestly.
    storage.headError = null;
    const retry = await complete({ uploadId }).expect(200);
    expect(retry.body.data.uploadStatus).toBe('UPLOADED');
    expect(retry.body.data.transcodeStatus).toBe('PENDING');
  });

  // ══ 4. An abort is final ════════════════════════════════════════════════════

  it('will not resurrect an aborted upload, even if bytes appear later', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();

    await complete({ uploadId }).expect(409); // empty bucket → ABORTED
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');

    // Someone now puts a perfectly valid object at the key. The asset still must
    // not flip to UPLOADED: the record says the upload failed, and a later
    // arrival at a known key is not the same event.
    storage.putObject(storageKey, body, 'audio/mpeg');

    const res = await complete({ uploadId }).expect(409);
    expect(res.body.error.code).toBe('UPLOAD_ABORTED');
    expect(res.body.error.message).toMatch(/start a new upload/i);
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');
    expect(row(uploadId)?.isUploaded).toBe(false);
  });

  it('refuses to confirm mismatched evidence at the domain layer too', () => {
    // Defence in depth: even a caller that bypasses the service cannot mark an
    // asset UPLOADED with the wrong byte count.
    const sha256 = 'b'.repeat(64);
    const asset = MediaAsset.create({
      id: UUIDv7.generate(),
      originalName: 'x.mp3',
      storageKey: 'originals/x/x.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 1000,
      sha256,
      uploadedBy: randomUUID(),
    });

    expect(() => asset.confirmUpload({ verifiedBytes: 999, verifiedAt: new Date() })).toThrow(
      /storage holds 999 bytes but 1000 were declared/,
    );
    expect(asset.uploadStatus).toBe('PENDING_UPLOAD');

    asset.abortUpload('test');
    expect(() => asset.confirmUpload({ verifiedBytes: 1000, verifiedAt: new Date() })).toThrow(
      /aborted and cannot be confirmed/,
    );
    expect(asset.uploadStatus).toBe('ABORTED');
  });

  // ══ 5. Multipart ════════════════════════════════════════════════════════════

  async function initiateMultipart() {
    const sizeBytes = MAX_SINGLE_PUT_BYTES + 1024;
    const res = await initiate({
      fileName: 'long-lecture.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes,
      sha256: createHash('sha256').update('long-lecture').digest('hex'),
    }).expect(200);
    return { sizeBytes, ...res.body.data };
  }

  it('refuses to assemble a multipart upload without the part list', async () => {
    const { uploadId, mode } = await initiateMultipart();
    expect(mode).toBe('MULTIPART');

    const res = await complete({ uploadId }).expect(400);

    expect(res.body.error.code).toBe('MULTIPART_PARTS_REQUIRED');
    expect(row(uploadId)?.isUploaded).toBe(false);
    // Nothing was assembled and nothing was verified.
    expect(storage.calls.some((c) => c.startsWith('completeMultipart:'))).toBe(false);
    expect(storage.calls.some((c) => c.startsWith('head:'))).toBe(false);
  });

  it('refuses a multipart upload whose parts assemble to nothing in storage', async () => {
    const { uploadId, storageKey } = await initiateMultipart();

    // The client reports parts. Storage accepts the call but — because the parts
    // were never actually uploaded — no object exists at the key afterwards.
    const res = await complete({
      uploadId,
      parts: [{ partNumber: 1, etag: '"deadbeef"' }],
    }).expect(409);

    expect(res.body.error.code).toBe('UPLOAD_NOT_FOUND_IN_STORAGE');
    expect(storage.calls).toContain(`completeMultipart:${storageKey}`);
    expect(storage.calls).toContain(`head:${storageKey}`);
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');
  });

  it('records an abort when storage rejects the part list', async () => {
    const { uploadId } = await initiateMultipart();
    storage.completeMultipartError = new Error('InvalidPart: one or more ETags did not match');

    const res = await complete({
      uploadId,
      parts: [{ partNumber: 1, etag: '"wrong"' }],
    }).expect(409);

    expect(res.body.error.code).toBe('UPLOAD_INCOMPLETE');
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');
    expect(row(uploadId)?.uploadError).toMatch(/Storage rejected multipart completion/);
  });

  /**
   * The three tests below encode what real storage actually does on the multipart
   * path, verified against live MinIO in s3-storage.minio.integration.spec.ts: it
   * keeps NO whole-file SHA-256 for a multipart object. The fake used to hand one
   * back regardless, which is how a real defect stayed hidden — `head()` never
   * requested checksum metadata from S3 at all, so the digest comparison in
   * `complete` was dead code against the actual bucket while passing here.
   *
   * Consequence to be honest about, in code and in the report: above 100 MB the
   * enforced control is the verified byte count, and the SHA-256 remains the
   * client's claim. It is never presented as more than that.
   */
  it('completes a multipart upload on size evidence without claiming a verified digest', async () => {
    const { uploadId, storageKey, sizeBytes } = await initiateMultipart();

    // The parts really were uploaded and assembled: an object of exactly the
    // declared size now exists — and, as on real storage, carries no SHA-256.
    storage.putMultipartObject(storageKey, Buffer.alloc(sizeBytes), 'audio/mpeg');
    expect(await storage.head(storageKey)).toMatchObject({
      sizeBytes,
      checksumSha256: null,
    });

    const res = await complete({
      uploadId,
      parts: [{ partNumber: 1, etag: '"a1"' }],
    }).expect(200);

    // Verified, on the evidence that exists: the size storage confirmed.
    expect(res.body.data.uploadStatus).toBe('UPLOADED');
    expect(res.body.data.verifiedBytes).toBe(sizeBytes);
    // And still no claim about a pipeline that does not exist.
    expect(res.body.data.transcodeStatus).toBe('PENDING');
    expect(JSON.stringify(res.body)).not.toContain('"DONE"');
  });

  it('still refuses a multipart upload of the wrong size, where no checksum can catch it', async () => {
    const { uploadId, storageKey, sizeBytes } = await initiateMultipart();

    // One part short. On this path the digest is unavailable, so if the size
    // check were also skipped, a truncated 100 MB lecture would be marked
    // UPLOADED — a fabricated verification with nothing behind it.
    storage.putMultipartObject(storageKey, Buffer.alloc(sizeBytes - 1024), 'audio/mpeg');

    const res = await complete({
      uploadId,
      parts: [{ partNumber: 1, etag: '"a1"' }],
    }).expect(409);

    expect(res.body.error.code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(res.body.error.details[0]).toEqual({
      verifiedBytes: sizeBytes - 1024,
      declaredBytes: sizeBytes,
    });
    expect(row(uploadId)?.uploadStatus).toBe('ABORTED');
    expect(row(uploadId)?.verifiedBytes).toBeNull();
  });

  it('aborts the storage-side session when the row cannot be saved', async () => {
    // If the DB write fails after the multipart session exists, the session must
    // be cleaned up: billable parts that no row references are an invisible leak.
    const repo = app.get<IMediaAssetRepository>(MEDIA_ASSET_REPOSITORY);
    const saveSpy = jest
      .spyOn(repo, 'save')
      .mockRejectedValueOnce(new Error('unique_violation on ct_media_assets'));

    await initiate({
      fileName: 'long-lecture.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: MAX_SINGLE_PUT_BYTES + 1024,
      sha256: createHash('sha256').update('doomed').digest('hex'),
    }).expect(500);

    expect(storage.calls.some((c) => c.startsWith('abortMultipart:'))).toBe(true);
    expect(assets).toHaveLength(0);
    saveSpy.mockRestore();
  });

  // ══ 6. The initiate side: no fabricated identity, no fabricated URL ═════════

  it('never answers initiate without a usable upload credential', async () => {
    const data = (await initiateSingle()) as Record<string, unknown>;

    // The stub returned `presignedUrl: null` with a 200. A 200 here means the
    // client has something it can actually upload with.
    expect(typeof data['uploadUrl']).toBe('string');
    expect(data['uploadUrl']).toMatch(/^https?:\/\//);
    expect(data['requiredHeaders']).toBeDefined();
    expect(data['mode']).toBe('SINGLE');
    expect(new Date(data['expiresAt'] as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('attributes the upload to the authenticated user and never to a placeholder', async () => {
    const { uploadId } = await initiateSingle();
    const asset = row(uploadId);

    expect(asset?.uploadedBy).toBe(editorId);
    // The stub fell back to `'00000000-0000-0000-0000-000000000000'`.
    expect(asset?.uploadedBy).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(asset?.uploadedBy).not.toMatch(/^0+(-0+)*$/);
  });

  it('rejects an unauthenticated initiate without creating a row', async () => {
    await request(app.getHttpServer())
      .post('/admin/media/upload/initiate')
      .send({
        fileName: 'lecture.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 100,
        sha256: 'c'.repeat(64),
      })
      .expect(401);

    expect(assets).toHaveLength(0);
    expect(storage.calls).toHaveLength(0);
  });

  it('builds the storage key itself and ignores the client filename entirely', async () => {
    const body = Buffer.from('traversal attempt', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const res = await initiate({
      // A filename engineered to steer the object out of `originals/`.
      fileName: '../../public-thumbnails/evil.html',
      mimeType: 'audio/mpeg',
      sizeBytes: body.length,
      sha256,
    }).expect(200);

    const key: string = res.body.data.storageKey;
    expect(key).toBe(`originals/${res.body.data.uploadId}/${sha256}.mp3`);
    expect(key).not.toContain('..');
    expect(key).not.toContain('evil');
    expect(key).not.toContain('.html');
    expect(key.endsWith('.mp3')).toBe(true);
    // The original name is still recorded for display — it just has no authority
    // over where the bytes land.
    expect(row(res.body.data.uploadId)?.originalName).toBe('../../public-thumbnails/evil.html');
  });

  // ══ 7. The closed whitelist and the size caps ══════════════════════════════

  it.each([
    ['text/html', 'stored XSS from an editor-supplied file'],
    ['video/mp4', 'no video — Charter §3.2'],
    ['application/octet-stream', 'anything at all'],
    ['image/svg+xml', 'scriptable image'],
  ])('refuses mimeType %s (%s) without creating a row', async (mimeType) => {
    const res = await initiate({
      fileName: 'payload.bin',
      mimeType,
      sizeBytes: 1024,
      sha256: 'd'.repeat(64),
    });

    // 422 from the service gate, 400 from the DTO's @IsIn — either is a refusal.
    expect([400, 422]).toContain(res.status);
    expect(assets).toHaveLength(0);
    expect(storage.calls).toHaveLength(0);
  });

  it.each([
    ['image/jpeg', 10 * 1024 * 1024 + 1, 'IMAGE'],
    ['application/pdf', 100 * 1024 * 1024 + 1, 'PDF'],
    ['audio/mpeg', 300 * 1024 * 1024 + 1, 'AUDIO'],
  ])('refuses %s above its cap and creates no row', async (mimeType, sizeBytes) => {
    const res = await initiate({
      fileName: 'too-big',
      mimeType,
      sizeBytes,
      sha256: 'e'.repeat(64),
    });

    expect([400, 422]).toContain(res.status);
    if (res.status === 422) {
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(res.body.error.details[0].maxBytes).toBeLessThan(sizeBytes);
    }
    expect(assets).toHaveLength(0);
    expect(storage.calls).toHaveLength(0);
  });

  it('rejects a sha256 that is not a sha256, so no key can be built from it', async () => {
    for (const sha256 of ['', 'not-a-hash', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      const res = await initiate({
        fileName: 'x.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 100,
        sha256,
      });
      expect(res.status).toBe(400);
    }
    expect(assets).toHaveLength(0);
  });

  // ══ 8. ADR-013 §3: bytes never traverse NestJS ═════════════════════════════

  it('accepts no file body on any media route', async () => {
    const bytes = Buffer.alloc(2048, 9);

    for (const path of ['/admin/media/upload/initiate', '/admin/media/upload/complete']) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${editorToken}`)
        .set('Content-Type', 'application/octet-stream')
        .send(bytes);

      // Whatever the exact status, it must not be a success: there is no route
      // that ingests media, and adding one would violate ADR-013 §3.
      expect(res.status).toBeGreaterThanOrEqual(400);
    }

    expect(assets).toHaveLength(0);
    expect(storage.keys()).toHaveLength(0);
  });

  it('does not leak the bucket path through the status endpoint', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();
    storage.putObject(storageKey, body, 'audio/mpeg');
    await complete({ uploadId }).expect(200);

    const st = await status(uploadId).expect(200);
    // API-002: clients get time-limited presigned URLs, not keys they can
    // assemble their own requests from.
    expect(st.body.data.storageKey).toBeUndefined();
    expect(JSON.stringify(st.body)).not.toContain(storageKey);
  });

  it('reports declared and verified sizes as separate facts', async () => {
    const { uploadId, storageKey, body } = await initiateSingle();
    storage.putObject(storageKey, body, 'audio/mpeg');
    await complete({ uploadId }).expect(200);

    const st = await status(uploadId).expect(200);
    // They happen to be equal here — that is the point. They are still two
    // fields, because collapsing them is how a claim becomes indistinguishable
    // from a measurement.
    expect(st.body.data.sizeBytes).toBe(body.length);
    expect(st.body.data.verifiedBytes).toBe(body.length);
    expect(Object.keys(st.body.data)).toContain('verifiedBytes');
  });

  it('refuses to complete an upload id that does not exist', async () => {
    const res = await complete({ uploadId: randomUUID() }).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(storage.calls).toHaveLength(0);
  });
});
