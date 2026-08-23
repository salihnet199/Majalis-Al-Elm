import { createHash } from 'crypto';
import {
  CompletedPart,
  IStorageService,
  MultipartUploadTicket,
  PresignedDownload,
  PresignedUpload,
  StoredObjectHead,
} from '../domain/ports/storage.service';

/**
 * FakeStorageService — an in-memory IStorageService for integration tests.
 *
 * NEVER registered by StorageModule and never imported by production code; it
 * lives under `testing/` and is excluded from tsconfig.app.json for that reason.
 * A fake that could be reached from a running server would be POLICY-SEC-001
 * category 4 (fabricated readiness) in its purest form.
 *
 * Its whole purpose is that the *storage side* of an upload can be controlled
 * independently of the API side. Tests can therefore reproduce the situation the
 * old stub could not distinguish: the client says "done", and the bucket is
 * empty. `putObject()` is the only way an object appears — nothing in the
 * request path creates one — so a `complete` call that succeeds without a prior
 * `putObject()` is a fabricated verification, and the regression suite asserts
 * exactly that it cannot happen.
 */
export class FakeStorageService implements IStorageService {
  /** key → stored object. Only `putObject`/`putMultipartObject` write here. */
  private readonly objects = new Map<
    string,
    { body: Buffer; contentType: string; multipart: boolean }
  >();

  /** uploadId → key, for multipart sessions that were initiated. */
  private readonly multipartSessions = new Map<string, { key: string; parts: CompletedPart[] }>();

  /** Recorded calls, so tests can assert what the service asked storage to do. */
  readonly calls: string[] = [];

  /** Set to make `head()` throw, modelling a 403/timeout rather than a 404. */
  headError: Error | null = null;

  /** Set to make `completeMultipart()` reject, as storage does on a bad part list. */
  completeMultipartError: Error | null = null;

  private uploadIdCounter = 0;

  // ── Test-side controls (the "client uploaded" side of the world) ────────────

  /** Simulates a successful client PUT (single-shot — storage records a SHA-256). */
  putObject(key: string, body: Buffer, contentType = 'application/octet-stream'): void {
    this.objects.set(key, { body, contentType, multipart: false });
  }

  /**
   * Simulates an object that arrived by MULTIPART assembly.
   *
   * The difference from `putObject` is not cosmetic: real storage holds no
   * whole-file SHA-256 for a multipart object, so `head()` reports
   * `checksumSha256: null` for one. Verified against live MinIO in
   * s3-storage.minio.integration.spec.ts. Use this for any test of the >100 MB
   * path, so the fake is not kinder than the bucket.
   */
  putMultipartObject(key: string, body: Buffer, contentType = 'application/octet-stream'): void {
    this.objects.set(key, { body, contentType, multipart: true });
  }

  /** Simulates a truncated or oversized client PUT. */
  putObjectOfSize(key: string, sizeBytes: number, contentType = 'application/octet-stream'): void {
    this.putObject(key, Buffer.alloc(sizeBytes, 7), contentType);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }

  reset(): void {
    this.objects.clear();
    this.multipartSessions.clear();
    this.calls.length = 0;
    this.headError = null;
    this.completeMultipartError = null;
    this.uploadIdCounter = 0;
  }

  // ── IStorageService ────────────────────────────────────────────────────────

  async presignUpload(params: {
    key: string;
    contentType: string;
    contentLength: number;
    sha256Hex: string;
    ttlSeconds: number;
  }): Promise<PresignedUpload> {
    this.calls.push(`presignUpload:${params.key}`);
    return {
      url: `https://fake-storage.test/${params.key}?X-Amz-Signature=fake`,
      requiredHeaders: {
        'Content-Type': params.contentType,
        'Content-Length': String(params.contentLength),
        'x-amz-checksum-sha256': Buffer.from(params.sha256Hex, 'hex').toString('base64'),
      },
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
    };
  }

  async presignDownload(params: {
    key: string;
    ttlSeconds: number;
    downloadFilename?: string;
  }): Promise<PresignedDownload> {
    this.calls.push(`presignDownload:${params.key}`);
    return {
      url: `https://fake-storage.test/${params.key}?X-Amz-Expires=${params.ttlSeconds}`,
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
    };
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    this.calls.push(`head:${key}`);

    // Models an inconclusive check (403, DNS, timeout). Per the port contract
    // this throws rather than returning null, because null means "provably
    // absent" and would cause a good upload to be marked ABORTED.
    if (this.headError) throw this.headError;

    const stored = this.objects.get(key);
    if (!stored) return null;

    return {
      sizeBytes: stored.body.length,
      contentType: stored.contentType,
      etag: `"${createHash('md5').update(stored.body).digest('hex')}"`,
      // Mirrors what real storage actually reports (see the port contract): a
      // whole-file digest for a single PUT, and nothing for a multipart object,
      // where S3 keeps a digest of the part digests instead. The fake used to
      // return a checksum unconditionally, which is how a genuine defect
      // survived — `head()` never asked S3 for checksum metadata at all, so the
      // comparison in `complete` was dead against real storage while every
      // mocked test exercised it happily.
      checksumSha256: stored.multipart
        ? null
        : createHash('sha256').update(stored.body).digest('base64'),
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.calls.push(`deleteObject:${key}`);
    this.objects.delete(key);
  }

  async initiateMultipart(params: {
    key: string;
    contentType: string;
    totalBytes: number;
    ttlSeconds: number;
  }): Promise<MultipartUploadTicket> {
    this.calls.push(`initiateMultipart:${params.key}`);
    const uploadId = `fake-upload-${++this.uploadIdCounter}`;
    this.multipartSessions.set(uploadId, { key: params.key, parts: [] });

    const partSizeBytes = 16 * 1024 * 1024;
    const partCount = Math.ceil(params.totalBytes / partSizeBytes);
    const parts = Array.from({ length: partCount }, (_, index) => {
      const partNumber = index + 1;
      return {
        partNumber,
        url: `https://fake-storage.test/${params.key}?partNumber=${partNumber}&uploadId=${uploadId}`,
        contentLength:
          partNumber === partCount
            ? params.totalBytes - partSizeBytes * (partCount - 1)
            : partSizeBytes,
      };
    });

    return {
      uploadId,
      partSizeBytes,
      parts,
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
    };
  }

  async completeMultipart(params: {
    key: string;
    uploadId: string;
    parts: CompletedPart[];
  }): Promise<void> {
    this.calls.push(`completeMultipart:${params.key}`);
    if (this.completeMultipartError) throw this.completeMultipartError;

    const session = this.multipartSessions.get(params.uploadId);
    if (!session) throw new Error(`No such multipart upload: ${params.uploadId}`);

    session.parts = params.parts;
    // Note what is NOT done here: no object is created. Real storage assembles
    // the object from parts that were actually uploaded, so a test that wants a
    // finished multipart object must call putObject() for it, exactly as a real
    // client would have to send the bytes.
  }

  async abortMultipart(params: { key: string; uploadId: string }): Promise<void> {
    this.calls.push(`abortMultipart:${params.key}`);
    this.multipartSessions.delete(params.uploadId);
  }

  async assertReachable(): Promise<void> {
    this.calls.push('assertReachable');
  }
}
