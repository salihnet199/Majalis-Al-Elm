/**
 * Media upload policy — the single source of truth for what may be uploaded.
 *
 * Charter §3.2: **no video**, ever. ADR-013 §2: keys are content-addressed.
 * Size caps approved by the sponsor on 2026-08-22: audio 300 MB, PDF 100 MB,
 * image 10 MB.
 *
 * This is a CLOSED whitelist, not a blocklist. The previous stub accepted any
 * `@IsString()` mimeType and any positive `sizeBytes`, which meant the media
 * bucket would accept `text/html` (stored XSS from an editor-supplied file) or a
 * 40 GB upload. Anything absent from this table is refused.
 */

export type MediaCategory = 'AUDIO' | 'PDF' | 'IMAGE';

export interface MediaTypeRule {
  mimeType: string;
  /** Extension used in the object key. Fixed by us — never taken from the client. */
  extension: string;
  maxBytes: number;
  category: MediaCategory;
  /** Arabic label, for error messages surfaced to editors. */
  labelAr: string;
}

const MB = 1024 * 1024;

export const AUDIO_MAX_BYTES = 300 * MB;
export const PDF_MAX_BYTES = 100 * MB;
export const IMAGE_MAX_BYTES = 10 * MB;

export const ALLOWED_MEDIA_UPLOADS: readonly MediaTypeRule[] = [
  { mimeType: 'audio/mpeg', extension: 'mp3',  maxBytes: AUDIO_MAX_BYTES, category: 'AUDIO', labelAr: 'ملف صوتي MP3' },
  { mimeType: 'audio/mp4',  extension: 'm4a',  maxBytes: AUDIO_MAX_BYTES, category: 'AUDIO', labelAr: 'ملف صوتي M4A' },
  { mimeType: 'audio/aac',  extension: 'aac',  maxBytes: AUDIO_MAX_BYTES, category: 'AUDIO', labelAr: 'ملف صوتي AAC' },
  { mimeType: 'application/pdf', extension: 'pdf', maxBytes: PDF_MAX_BYTES, category: 'PDF', labelAr: 'ملف PDF' },
  { mimeType: 'image/jpeg', extension: 'jpg',  maxBytes: IMAGE_MAX_BYTES, category: 'IMAGE', labelAr: 'صورة JPEG' },
  { mimeType: 'image/png',  extension: 'png',  maxBytes: IMAGE_MAX_BYTES, category: 'IMAGE', labelAr: 'صورة PNG' },
  { mimeType: 'image/webp', extension: 'webp', maxBytes: IMAGE_MAX_BYTES, category: 'IMAGE', labelAr: 'صورة WebP' },
];

export const ALLOWED_MIME_TYPES: readonly string[] = ALLOWED_MEDIA_UPLOADS.map((r) => r.mimeType);

/**
 * Above this, the upload is split into parts. Note PDF and image caps are at or
 * below it, so only audio ever goes multipart.
 */
export const MAX_SINGLE_PUT_BYTES = 100 * MB;

/** The largest cap in the table — the DTO's absolute upper bound. */
export const ABSOLUTE_MAX_UPLOAD_BYTES = Math.max(...ALLOWED_MEDIA_UPLOADS.map((r) => r.maxBytes));

/**
 * 5 minutes. Short on purpose: a presigned PUT is a bearer credential that lets
 * its holder write to the bucket, so its lifetime should cover starting an
 * upload, not sitting in a log file. Multipart part URLs get longer (below)
 * because a 300 MB upload legitimately takes longer than five minutes.
 */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** 2 hours — enough for 300 MB on a slow connection. */
export const MULTIPART_URL_TTL_SECONDS = 2 * 60 * 60;

/** API-002: 60 minutes for protected media streaming. */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function resolveUploadRule(mimeType: string): MediaTypeRule | undefined {
  return ALLOWED_MEDIA_UPLOADS.find((rule) => rule.mimeType === mimeType.trim().toLowerCase());
}

/**
 * S3-compatible services carry checksums base64-encoded, while we store and key
 * on lowercase hex. Defined once here so the adapter and the verification path
 * cannot drift into two different encodings and silently stop matching.
 */
export function sha256HexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

/**
 * ADR-013 §2: `originals/<media_id>/<sha256>.<ext>`.
 *
 * Every component is server-controlled: a generated UUIDv7, a hex hash validated
 * against SHA256_HEX_PATTERN, and an extension from the table above. The
 * client's filename never appears — the stub used it directly, which let an
 * editor-supplied name like `../../public-thumbnails/x.html` decide where the
 * object landed.
 */
export function buildOriginalKey(params: {
  mediaId: string;
  sha256: string;
  extension: string;
}): string {
  if (!SHA256_HEX_PATTERN.test(params.sha256)) {
    throw new Error(`Refusing to build a storage key from a non-SHA-256 value: "${params.sha256}"`);
  }
  return `originals/${params.mediaId}/${params.sha256}.${params.extension}`;
}

export function formatBytesAr(bytes: number): string {
  if (bytes >= MB) return `${Math.round(bytes / MB)} ميجابايت`;
  return `${Math.round(bytes / 1024)} كيلوبايت`;
}
