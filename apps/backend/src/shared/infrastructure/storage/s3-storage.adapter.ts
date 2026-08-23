import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256HexToBase64 } from '../../../modules/content/domain/media-upload.policy';
import {
  CompletedPart,
  IStorageService,
  MultipartUploadTicket,
  PresignedDownload,
  PresignedUpload,
  StoredObjectHead,
} from '../../../modules/content/domain/ports/storage.service';

/**
 * S3StorageAdapter — the ONLY file in the application that imports `@aws-sdk/*`.
 *
 * (One ops script, `scripts/ensure-media-bucket.mjs`, also uses the SDK to create
 * the local bucket. It is not part of the running application and is never
 * imported by it.)
 *
 * ADR-013 §1: any S3-compatible vendor, selected purely by environment
 * variables. Cloudflare R2, MinIO, Backblaze B2 and AWS S3 all speak the same
 * API, so the vendor swap the sponsor asked for (MinIO now → R2 before
 * deployment) is a change to `.env`, with no code edit. `forcePathStyle: true`
 * is what makes that true in practice: MinIO and R2 both require path-style
 * addressing, and it is harmless on AWS.
 *
 * ADR-013 §3: media bytes never pass through this process. Every method here
 * either signs a URL for the client to use directly, or reads/writes metadata.
 * No method accepts or returns a body.
 */

export interface S3StorageConfig {
  /** Address this process uses for API calls (head, multipart, bucket probe). */
  endpoint: string;
  /**
   * Address the CLIENT will call, used only for signing URLs.
   *
   * Identical to `endpoint` on R2/AWS. It differs under local Docker, where the
   * backend reaches MinIO as `http://minio:9000` and the browser as
   * `http://localhost:9000`. This cannot be handled by rewriting the host of a
   * finished URL: SigV4 includes `host` in the signed headers of a presigned
   * request, so the signature is only valid for the host it was signed against.
   */
  publicEndpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Required by MinIO and R2; harmless on AWS S3. */
  forcePathStyle: boolean;
}

export const S3_STORAGE_CONFIG = Symbol('S3_STORAGE_CONFIG');

/**
 * 16 MiB parts: above S3's 5 MiB minimum, and small enough that a browser
 * holding three slices in flight uses ~48 MiB. At the 300 MB audio cap this is
 * 19 parts, far below the 10 000-part limit.
 */
export const MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024;

/** S3 hard minimum for every part except the last. */
const S3_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Strips anything that could break out of the Content-Disposition header or
 * escape a directory. The value ends up in a signed query parameter that the
 * storage service echoes back as a response header, so an unsanitised filename
 * is a header-injection vector.
 */
function sanitiseFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\r\n\t"\\]/g, '')
    .replace(/[/\\]/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'download';
}

function isNotFound(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.name === 'NotFound' ||
    err?.name === 'NoSuchKey' ||
    err?.$metadata?.httpStatusCode === 404
  );
}

/**
 * `ChecksumSHA256` on a HeadObject response means one of two different things:
 *
 *   • single PUT — the SHA-256 of the object's bytes, base64 (44 chars, `=`-padded)
 *   • multipart  — a digest OF THE PART DIGESTS, suffixed `-<partCount>`
 *
 * Only the first is a content digest of the file, and only the first may be
 * compared against the SHA-256 the client declared at initiate. Returning a
 * composite value would make `complete` reject a perfectly good 200 MB lecture
 * with UPLOAD_CHECKSUM_MISMATCH, so a composite is reported as "no whole-file
 * checksum available" — which is the truth, and which is why the multipart path
 * is size-verified rather than digest-verified.
 */
function wholeObjectSha256(value: string | undefined): string | null {
  if (!value) return null;
  if (/-\d+$/.test(value)) return null;
  return value;
}

@Injectable()
export class S3StorageAdapter implements IStorageService {
  private readonly logger = new Logger(S3StorageAdapter.name);
  /** For API calls made by this process. */
  private readonly client: S3Client;
  /** For signing URLs the client opens. Same instance when the hosts match. */
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject(S3_STORAGE_CONFIG) private readonly config: S3StorageConfig) {
    this.bucket = config.bucket;

    const shared = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // The SDK otherwise adds an automatic CRC32 checksum header to PutObject.
      // On a presigned URL that header becomes part of the signature, and the
      // browser has no way to produce it — every upload would 403. WHEN_REQUIRED
      // suppresses the automatic one while still honouring the SHA-256 we set
      // explicitly, which is the checksum we actually want enforced.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };

    this.client = new S3Client({ ...shared, endpoint: config.endpoint });

    // A second client only when the two addresses genuinely differ, so the
    // common single-host deployment keeps exactly one connection pool.
    this.signingClient =
      config.publicEndpoint && config.publicEndpoint !== config.endpoint
        ? new S3Client({ ...shared, endpoint: config.publicEndpoint })
        : this.client;
  }

  /**
   * Signs a single-shot PUT.
   *
   * Three of the four signed elements are integrity controls, and all three are
   * enforced by the STORAGE SERVICE rather than by trusting the client:
   *
   *   • `content-length` — ADR-013 asks for `content-length-range`, but that is
   *     a presigned-POST-policy feature and does not exist for a signed PUT.
   *     Signing the exact length is the equivalent available control (approved
   *     deviation, 2026-08-22): the browser sets Content-Length itself from the
   *     Blob and cannot lie about it, so a body of any other size produces a
   *     signature mismatch and a 403 from storage.
   *   • `content-type` — pinned to the whitelisted type, so a client cannot
   *     declare `audio/mpeg` at initiate and then store `text/html`.
   *   • `x-amz-checksum-sha256` — storage recomputes SHA-256 over the received
   *     body and rejects the request if it differs. This is the strong one: it
   *     makes the object key (built from the same hash) a verified content
   *     address rather than a claim.
   */
  async presignUpload(params: {
    key: string;
    contentType: string;
    contentLength: number;
    sha256Hex: string;
    ttlSeconds: number;
  }): Promise<PresignedUpload> {
    const checksumBase64 = sha256HexToBase64(params.sha256Hex);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
      ChecksumSHA256: checksumBase64,
    });

    const url = await getSignedUrl(this.signingClient, command, {
      expiresIn: params.ttlSeconds,
      signableHeaders: new Set(['content-length', 'content-type', 'x-amz-checksum-sha256']),
    });

    return {
      url,
      requiredHeaders: {
        'Content-Type': params.contentType,
        'Content-Length': String(params.contentLength),
        'x-amz-checksum-sha256': checksumBase64,
      },
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
    };
  }

  async presignDownload(params: {
    key: string;
    ttlSeconds: number;
    downloadFilename?: string;
  }): Promise<PresignedDownload> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ...(params.downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
              sanitiseFilename(params.downloadFilename),
            )}`,
          }
        : {}),
    });

    const url = await getSignedUrl(this.signingClient, command, {
      expiresIn: params.ttlSeconds,
    });

    return { url, expiresAt: new Date(Date.now() + params.ttlSeconds * 1000) };
  }

  /**
   * See the port's contract: `null` means "provably absent", and every other
   * failure throws. The two must never be conflated — `null` causes an upload to
   * be marked ABORTED, so folding a timeout into it would discard a good file,
   * and folding it the other way would fabricate a verified upload.
   */
  async head(key: string): Promise<StoredObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          // Not optional. S3-compatible services omit checksum headers from a
          // HeadObject response unless this is set, so without it
          // `checksumSha256` is null for EVERY object and the checksum
          // comparison in MediaUploadService.complete() — the strongest
          // verification in the pipeline — silently never runs. It went
          // unnoticed until s3-storage.minio.integration.spec.ts ran against
          // real MinIO: the fake returns a checksum unconditionally, so the
          // mocked tests could not see it.
          ChecksumMode: 'ENABLED',
        }),
      );

      return {
        sizeBytes: Number(result.ContentLength ?? 0),
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        checksumSha256: wholeObjectSha256(result.ChecksumSHA256),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async initiateMultipart(params: {
    key: string;
    contentType: string;
    totalBytes: number;
    ttlSeconds: number;
  }): Promise<MultipartUploadTicket> {
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        ContentType: params.contentType,
      }),
    );

    if (!created.UploadId) {
      // No fabricated ticket: without an upload id there is no upload.
      throw new Error(`Storage did not return an UploadId for key ${params.key}`);
    }

    const partSize = MULTIPART_PART_SIZE_BYTES;
    const partCount = Math.ceil(params.totalBytes / partSize);
    const parts: MultipartUploadTicket['parts'] = [];

    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const contentLength =
        partNumber === partCount ? params.totalBytes - partSize * (partCount - 1) : partSize;

      // Guard against a caller asking for a size the storage service will
      // reject on the wire rather than here.
      if (partCount > 1 && partNumber < partCount && contentLength < S3_MIN_PART_SIZE_BYTES) {
        throw new Error(
          `Computed part size ${contentLength} is below the S3 minimum of ${S3_MIN_PART_SIZE_BYTES}`,
        );
      }

      const url = await getSignedUrl(
        this.signingClient,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: params.key,
          UploadId: created.UploadId,
          PartNumber: partNumber,
          ContentLength: contentLength,
        }),
        {
          expiresIn: params.ttlSeconds,
          signableHeaders: new Set(['content-length']),
        },
      );

      parts.push({ partNumber, url, contentLength });
    }

    return {
      uploadId: created.UploadId,
      partSizeBytes: partSize,
      parts,
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
    };
  }

  async completeMultipart(params: {
    key: string;
    uploadId: string;
    parts: CompletedPart[];
  }): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: [...params.parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
  }

  async abortMultipart(params: { key: string; uploadId: string }): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
      }),
    );
  }

  /**
   * Layer 3 of the storage guard: a real network call. Layers 1 and 2 prove the
   * configuration is present and sane; only this proves the bucket exists and
   * these credentials can reach it. Called at boot, and a throw here must stop
   * the process — per the sponsor's Stage A decision there is no degraded
   * "no uploads" mode to fall back to.
   */
  async assertReachable(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(
        `Object storage reachable: bucket "${this.bucket}" at ${this.config.endpoint}`,
      );
    } catch (error) {
      const err = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      const status = err?.$metadata?.httpStatusCode;

      const diagnosis =
        status === 404 || err?.name === 'NotFound'
          ? `the bucket "${this.bucket}" does not exist — create it ` +
            '(node scripts/ensure-media-bucket.mjs) or fix S3_BUCKET_NAME'
          : status === 403 || err?.name === 'Forbidden'
            ? 'the credentials were rejected — check S3_ACCESS_KEY / S3_SECRET_KEY'
            : `could not connect to ${this.config.endpoint} — is the storage service running? (${err?.name ?? 'unknown error'}: ${err?.message ?? ''})`;

      throw new Error(
        `Object storage is not reachable — refusing to start (ADR-013): ${diagnosis}.\n` +
          'Media upload is a core capability of this platform, so the server does not start ' +
          'without it. For local development:\n' +
          '  docker compose --env-file .env.local up -d minio\n' +
          '  node scripts/ensure-media-bucket.mjs',
      );
    }
  }
}
