/**
 * IStorageService — the ONLY contract between application code and the object store.
 *
 * ADR-013 §1: "S3 API only — no vendor-specific SDK imports." Switching Cloudflare R2
 * → Backblaze B2 → self-hosted MinIO → AWS S3 must be an env-var change, never a code
 * change. That guarantee only holds if nothing outside the adapter knows which vendor
 * is behind this interface — so no AWS SDK type may appear in this file, and no
 * `@aws-sdk/*` import may appear anywhere in `modules/`.
 *
 * ADR-013 §3 (MANDATORY): media bytes NEVER traverse NestJS. There is deliberately no
 * `upload(buffer)` method here. The backend signs URLs; the client PUTs directly to the
 * bucket. Adding a passthrough method to this port would reintroduce the exact OOM class
 * the ADR exists to prevent.
 */

/** A presigned PUT the client uses to send bytes straight to the bucket. */
export interface PresignedUpload {
  url: string;
  /**
   * Headers the client MUST send verbatim. They are part of the signature, so a
   * client that changes the content type or the body length breaks the signature and
   * the bucket rejects the request with 403 — enforcement happens at the storage
   * layer, not on trust.
   */
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
}

/** A presigned GET for reading a protected object (API-002: 60-minute TTL). */
export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

/** What storage actually holds — the authoritative facts about an object. */
export interface StoredObjectHead {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  /**
   * Base64 SHA-256 **of the whole object**, or null when storage holds no such
   * digest — which is the normal case for a multipart object, because S3 records
   * a digest of the part digests there rather than of the file. Implementations
   * MUST return null instead of that composite value: it is not the file's
   * SHA-256, and comparing it to the client's declared digest would reject a
   * valid upload. Consequence, stated plainly: single-PUT uploads (≤100 MB) are
   * digest-verified by storage; multipart uploads are size-verified, and their
   * SHA-256 remains client-declared.
   */
  checksumSha256: string | null;
}

export interface MultipartUploadTicket {
  uploadId: string;
  partSizeBytes: number;
  /** One presigned URL per part, 1-indexed by `partNumber` as S3 requires. */
  parts: Array<{ partNumber: number; url: string; contentLength: number }>;
  expiresAt: Date;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface IStorageService {
  /**
   * Sign a single-shot PUT. `sha256Hex` is sent on as a checksum header so the bucket
   * itself refuses a body that does not hash to it.
   */
  presignUpload(params: {
    key: string;
    contentType: string;
    contentLength: number;
    sha256Hex: string;
    ttlSeconds: number;
  }): Promise<PresignedUpload>;

  presignDownload(params: {
    key: string;
    ttlSeconds: number;
    /** Sets Content-Disposition so the browser/app names the saved file sensibly. */
    downloadFilename?: string;
  }): Promise<PresignedDownload>;

  /**
   * Read an object's real metadata.
   *
   * Returns `null` **only** when the object genuinely does not exist (404/NoSuchKey).
   * Any other failure — 403, DNS, timeout, TLS — MUST throw.
   *
   * This distinction is the whole point of the method and is load-bearing for
   * POLICY-SEC-001: `complete` treats `null` as "the upload did not happen" and
   * aborts the asset. If a transient network error were folded into `null`, a
   * perfectly good upload would be discarded; if it were folded into a fake head
   * result, we would mark an asset UPLOADED without evidence. Neither is acceptable,
   * so errors propagate and the caller reports a real failure.
   */
  head(key: string): Promise<StoredObjectHead | null>;

  deleteObject(key: string): Promise<void>;

  initiateMultipart(params: {
    key: string;
    contentType: string;
    totalBytes: number;
    ttlSeconds: number;
  }): Promise<MultipartUploadTicket>;

  completeMultipart(params: {
    key: string;
    uploadId: string;
    parts: CompletedPart[];
  }): Promise<void>;

  abortMultipart(params: { key: string; uploadId: string }): Promise<void>;

  /**
   * Verify the configured bucket exists and these credentials can reach it.
   * Called at boot; throwing here must prevent the server from starting.
   */
  assertReachable(): Promise<void>;
}

export const STORAGE_SERVICE = Symbol('IStorageService');
