import { apiClient } from './client';

/**
 * Presigned direct upload from the admin browser (ADR-013 Stage A, client side).
 *
 * The bytes go from this browser straight to the object store. They do not pass
 * through NestJS — ADR-013 §3 — so this module talks to two different servers in
 * one operation: our API (JSON only: initiate, complete) and the storage service
 * (the file body, over a URL our API signed).
 *
 * ── POLICY-SEC-001 (docs/governance/TECHNICAL_DEBT.md) ──────────────────────
 * Four places in this flow are where a convenient lie could be told, and each is
 * a hard failure here instead:
 *
 *   1. The SHA-256 must be computed by WebCrypto. If `crypto.subtle` is missing
 *      (an insecure origin: plain http on a non-localhost host), this throws.
 *      It NEVER substitutes a placeholder or a cheaper hash — the digest becomes
 *      the object key and is enforced by the storage service, so a fabricated one
 *      would produce a content address that does not address the content.
 *   2. A multipart part's ETag must be read from the storage response. If the
 *      header is not readable, this throws with the CORS fix in the message. It
 *      never invents an ETag: `CompleteMultipartUpload` would reject it anyway,
 *      and an invented one turns a diagnosable CORS problem into a mystery.
 *   3. Success is what the SERVER confirmed, not what this code hoped. The result
 *      is returned only when `complete` reports `uploadStatus: 'UPLOADED'` and a
 *      `verifiedBytes` equal to the file's real length.
 *   4. `transcodeStatus` is passed through untouched. ADR-013 Stage B (media
 *      processing) is not implemented, so it stays PENDING and the UI says so.
 *
 * ── Operational prerequisite ────────────────────────────────────────────────
 * The storage bucket needs CORS that allows PUT from the admin origin, allows the
 * `content-type` and `x-amz-checksum-sha256` request headers, and — for files
 * above 100 MB — EXPOSES the `ETag` response header. Without the last one the
 * multipart path cannot work at all; see the ETAG_NOT_EXPOSED message below.
 */

// ── Errors ───────────────────────────────────────────────────────────────────

export type MediaUploadErrorCode =
  | 'CRYPTO_UNAVAILABLE'
  | 'FILE_UNREADABLE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INITIATE_FAILED'
  | 'STORAGE_REJECTED'
  | 'NETWORK_FAILED'
  | 'ETAG_NOT_EXPOSED'
  | 'COMPLETE_FAILED'
  | 'VERIFICATION_INCOMPLETE'
  | 'ABORTED';

/** Carries a machine-readable code so the UI can react without parsing Arabic. */
export class MediaUploadError extends Error {
  readonly code: MediaUploadErrorCode;
  readonly cause?: unknown;

  constructor(code: MediaUploadErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MediaUploadError';
    this.code = code;
    this.cause = cause;
  }
}

// ── Progress ─────────────────────────────────────────────────────────────────

export type UploadPhase = 'HASHING' | 'UPLOADING' | 'VERIFYING';

export interface UploadProgress {
  phase: UploadPhase;
  loadedBytes: number;
  totalBytes: number;
  /** 0–100, integer. Real bytes only — never a timer-driven animation. */
  percent: number;
}

/** What the SERVER confirmed. Constructed in exactly one place, after checks. */
export interface VerifiedUpload {
  mediaAssetId: string;
  /** Bytes storage was confirmed to hold, as reported by headObject. */
  verifiedBytes: number;
  sha256: string;
  uploadStatus: 'UPLOADED';
  /** PENDING until ADR-013 Stage B exists. Passed through, never interpreted. */
  transcodeStatus: string;
  transcodeNote?: string;
  fileName: string;
  mimeType: string;
  mode: 'SINGLE' | 'MULTIPART';
}

// ── Client-side mirror of the server's upload policy ──────────────────────────

/**
 * apps/backend/src/modules/content/domain/media-upload.policy.ts is authoritative.
 * This copy exists only so the editor learns about a 400 MB file or a .mkv before
 * a round trip, and so the file picker can filter. If the two ever drift, the
 * server refuses the upload and its message is what the editor sees — this table
 * can be over-strict or out of date without ever letting something through.
 */
export interface ClientMediaRule {
  mimeType: string;
  extensions: readonly string[];
  maxBytes: number;
  labelAr: string;
  category: 'AUDIO' | 'PDF' | 'IMAGE';
}

const MB = 1024 * 1024;

export const CLIENT_MEDIA_RULES: readonly ClientMediaRule[] = [
  { mimeType: 'audio/mpeg', extensions: ['mp3'], maxBytes: 300 * MB, labelAr: 'ملف صوتي MP3', category: 'AUDIO' },
  { mimeType: 'audio/mp4', extensions: ['m4a', 'mp4a'], maxBytes: 300 * MB, labelAr: 'ملف صوتي M4A', category: 'AUDIO' },
  { mimeType: 'audio/aac', extensions: ['aac'], maxBytes: 300 * MB, labelAr: 'ملف صوتي AAC', category: 'AUDIO' },
  { mimeType: 'application/pdf', extensions: ['pdf'], maxBytes: 100 * MB, labelAr: 'ملف PDF', category: 'PDF' },
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], maxBytes: 10 * MB, labelAr: 'صورة JPEG', category: 'IMAGE' },
  { mimeType: 'image/png', extensions: ['png'], maxBytes: 10 * MB, labelAr: 'صورة PNG', category: 'IMAGE' },
  { mimeType: 'image/webp', extensions: ['webp'], maxBytes: 10 * MB, labelAr: 'صورة WebP', category: 'IMAGE' },
];

/** Above this the server issues a multipart ticket instead of one PUT. */
export const MAX_SINGLE_PUT_BYTES = 100 * MB;

export function formatBytesAr(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} ميجابايت`;
  return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
}

/**
 * Resolves the MIME type to declare, preferring the browser's sniffed type and
 * falling back to the extension.
 *
 * The fallback is needed, not cosmetic: Windows installations regularly report an
 * empty `File.type` for .m4a and .aac, and the declared type is pinned into the
 * presigned signature, so getting it wrong means a 403 from storage rather than a
 * readable message.
 */
export function resolveClientRule(file: File): ClientMediaRule | undefined {
  const declared = (file.type || '').trim().toLowerCase();
  const byMime = CLIENT_MEDIA_RULES.find((rule) => rule.mimeType === declared);
  if (byMime) return byMime;

  const extension = file.name.split('.').pop()?.trim().toLowerCase() ?? '';
  if (!extension) return undefined;
  return CLIENT_MEDIA_RULES.find((rule) => rule.extensions.includes(extension));
}

/** `accept` attribute for a content type, so the picker offers the right files. */
export function acceptAttributeForContentType(contentType: string): string {
  const category =
    contentType === 'AUDIO' ? 'AUDIO' : contentType === 'PDF' ? 'PDF' : contentType === 'IMAGE' ? 'IMAGE' : null;

  const rules = category
    ? CLIENT_MEDIA_RULES.filter((rule) => rule.category === category)
    : CLIENT_MEDIA_RULES;

  return rules
    .flatMap((rule) => [rule.mimeType, ...rule.extensions.map((extension) => `.${extension}`)])
    .join(',');
}

export const ALLOWED_TYPES_AR = CLIENT_MEDIA_RULES.map(
  (rule) => `${rule.labelAr} (حد أقصى ${formatBytesAr(rule.maxBytes)})`,
).join('، ');

// ── Hashing ──────────────────────────────────────────────────────────────────

const READ_CHUNK_BYTES = 8 * MB;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MediaUploadError('ABORTED', 'تم إلغاء الرفع قبل اكتماله');
  }
}

/**
 * Reads the whole file into memory, reporting real read progress.
 *
 * Why the whole file: `crypto.subtle.digest` has no incremental form, and the
 * digest is required BEFORE `initiate` because it is part of the object key.
 * The cost is one buffer the size of the file — at the 300 MB audio cap that is
 * real, so an allocation failure is reported honestly rather than worked around
 * with a hash this code computes itself. Hand-rolling SHA-256 for an integrity
 * control that storage independently enforces is not a trade worth making.
 */
async function readFileBytes(
  file: File,
  onRead: (loadedBytes: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(file.size);
  } catch (error) {
    throw new MediaUploadError(
      'FILE_UNREADABLE',
      `تعذّر تجهيز الملف في الذاكرة (${formatBytesAr(file.size)}). أغلق التطبيقات الأخرى ` +
        'وحاول مرة أخرى، أو استخدم ملفاً أصغر.',
      error,
    );
  }

  let offset = 0;
  while (offset < file.size) {
    throwIfAborted(signal);

    const end = Math.min(offset + READ_CHUNK_BYTES, file.size);
    let chunk: ArrayBuffer;
    try {
      chunk = await file.slice(offset, end).arrayBuffer();
    } catch (error) {
      throw new MediaUploadError(
        'FILE_UNREADABLE',
        'تعذّرت قراءة الملف من القرص — قد يكون قد نُقل أو حُذف أو تغيّر أثناء الرفع. ' +
          'أعد اختيار الملف.',
        error,
      );
    }

    if (chunk.byteLength === 0) {
      // A zero-length read before the end means the file shrank under us. Looping
      // forever or hashing a partially-filled buffer would both be worse.
      throw new MediaUploadError(
        'FILE_UNREADABLE',
        `توقّفت قراءة الملف عند ${formatBytesAr(offset)} من ${formatBytesAr(file.size)} — ` +
          'تغيّر الملف أثناء القراءة. أعد اختيار الملف.',
      );
    }

    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
    onRead(offset);
  }

  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Lowercase hex SHA-256, computed by the platform.
 *
 * `crypto.subtle` is undefined on an insecure origin. That is a deployment
 * mistake with a specific fix, so it gets a specific message — and never a
 * fallback, because every alternative available here (a truncated hash, a random
 * value, the file size) would be a fabricated content address.
 */
export async function computeSha256Hex(
  file: File,
  onProgress?: (loadedBytes: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new MediaUploadError(
      'CRYPTO_UNAVAILABLE',
      'تعذّر حساب بصمة الملف (SHA-256): واجهة التشفير في المتصفح غير متاحة. ' +
        'تحدث هذه الحالة عند فتح لوحة التحكم عبر http على عنوان غير localhost. ' +
        'افتح اللوحة عبر https أو على localhost. لن يُرفع أي ملف دون بصمة حقيقية.',
    );
  }

  const bytes = await readFileBytes(file, (loaded) => onProgress?.(loaded), signal);
  throwIfAborted(signal);

  // Node 18+/browser typings disagree about BufferSource here; the runtime accepts
  // a Uint8Array in both, and the copy the DOM lib would demand is 300 MB.
  const digest = await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return toHex(digest);
}

// ── Raw PUT to storage ───────────────────────────────────────────────────────

interface PutOutcome {
  status: number;
  etag: string | null;
  responseText: string;
}

/**
 * One PUT of one Blob, with real upload progress.
 *
 * XHR rather than fetch for a single reason: `fetch` has no upload-progress
 * event, and a 300 MB upload with no progress bar is indistinguishable from a
 * hung one.
 */
function putBlob(params: {
  url: string;
  body: Blob;
  headers: Record<string, string>;
  onProgress?: (loadedBytes: number) => void;
  signal?: AbortSignal;
}): Promise<PutOutcome> {
  return new Promise<PutOutcome>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', params.url, true);

    for (const [name, value] of Object.entries(params.headers)) {
      // Content-Length is a forbidden header name: the browser refuses to let
      // script set it and computes it from the Blob instead. That is exactly why
      // the server signs it — the client cannot claim one length and send
      // another. Sending it here would only produce a console warning.
      if (name.toLowerCase() === 'content-length') continue;
      xhr.setRequestHeader(name, value);
    }

    if (params.onProgress) {
      xhr.upload.onprogress = (event) => params.onProgress?.(event.loaded);
    }

    const onAbortSignal = () => xhr.abort();
    params.signal?.addEventListener('abort', onAbortSignal, { once: true });

    const cleanup = () => params.signal?.removeEventListener('abort', onAbortSignal);

    xhr.onload = () => {
      cleanup();
      resolve({
        status: xhr.status,
        // Null when the header exists but CORS does not expose it — the caller
        // decides what that means; this function does not guess.
        etag: xhr.getResponseHeader('ETag'),
        responseText: typeof xhr.responseText === 'string' ? xhr.responseText.slice(0, 400) : '',
      });
    };

    xhr.onerror = () => {
      cleanup();
      // A CORS rejection is indistinguishable from a dead host at this layer, so
      // the message names both possibilities instead of picking one.
      reject(
        new MediaUploadError(
          'NETWORK_FAILED',
          'تعذّر الاتصال بخدمة التخزين لرفع الملف. تحقّق من أن الخدمة تعمل ومن إعداد CORS ' +
            'للسماح بطلبات PUT من عنوان لوحة التحكم.',
        ),
      );
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new MediaUploadError('NETWORK_FAILED', 'انتهت مدة انتظار خدمة التخزين أثناء رفع الملف'));
    };

    xhr.onabort = () => {
      cleanup();
      reject(new MediaUploadError('ABORTED', 'تم إلغاء الرفع'));
    };

    xhr.send(params.body);
  });
}

function describeStorageRejection(outcome: PutOutcome, context: string): MediaUploadError {
  // Storage replies with an XML <Code> that says precisely what was wrong; it is
  // far more useful to the reader than "فشل الرفع".
  const storageCode = /<Code>([^<]+)<\/Code>/.exec(outcome.responseText)?.[1];

  const hint =
    outcome.status === 403
      ? 'انتهت صلاحية رابط الرفع أو لم تُطابق الترويسات ما وُقِّع عليه (الحجم أو نوع الملف أو البصمة). ' +
        'أعد المحاولة من جديد.'
      : outcome.status === 400
        ? 'رفضت خدمة التخزين محتوى الطلب.'
        : 'رفضت خدمة التخزين الطلب.';

  return new MediaUploadError(
    'STORAGE_REJECTED',
    `${hint} (${context}: HTTP ${outcome.status}${storageCode ? ` — ${storageCode}` : ''})`,
  );
}

// ── API calls ────────────────────────────────────────────────────────────────

interface InitiateSingleResponse {
  uploadId: string;
  mode: 'SINGLE';
  storageKey: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

interface InitiateMultipartResponse {
  uploadId: string;
  mode: 'MULTIPART';
  storageKey: string;
  partSizeBytes: number;
  parts: Array<{ partNumber: number; url: string; contentLength: number }>;
  expiresAt: string;
}

type InitiateResponse = InitiateSingleResponse | InitiateMultipartResponse;

interface CompleteResponse {
  mediaAssetId: string;
  uploadStatus: string;
  verifiedBytes: number | null;
  sha256: string | null;
  uploadedAt: string | null;
  alreadyComplete: boolean;
  transcodeStatus: string;
  transcodeNote?: string;
}

async function initiate(body: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}): Promise<InitiateResponse> {
  const response = await apiClient.post('/admin/media/upload/initiate', body);
  const data = response.data?.data as InitiateResponse | undefined;

  if (!data?.uploadId || !data?.mode) {
    throw new MediaUploadError(
      'INITIATE_FAILED',
      'استجابة غير مفهومة من الخادم عند بدء الرفع — لم يُصدر تصريح رفع صالح',
    );
  }

  if (data.mode === 'SINGLE' && !data.uploadUrl) {
    // The stub this replaced returned `presignedUrl: null` and reported success.
    throw new MediaUploadError(
      'INITIATE_FAILED',
      'لم يُصدر الخادم رابط رفع موقّعاً — لا يمكن رفع الملف. راجع إعداد خدمة التخزين على الخادم.',
    );
  }

  if (data.mode === 'MULTIPART' && !(data.parts?.length > 0)) {
    throw new MediaUploadError(
      'INITIATE_FAILED',
      'لم يُصدر الخادم روابط أجزاء الرفع للملف الكبير — لا يمكن رفع الملف.',
    );
  }

  return data;
}

async function complete(body: {
  uploadId: string;
  parts?: Array<{ partNumber: number; etag: string }>;
}): Promise<CompleteResponse> {
  const response = await apiClient.post('/admin/media/upload/complete', body);
  const data = response.data?.data as CompleteResponse | undefined;

  if (!data) {
    throw new MediaUploadError(
      'COMPLETE_FAILED',
      'استجابة غير مفهومة من الخادم عند تأكيد الرفع — لم يُتحقَّق من الملف',
    );
  }

  return data;
}

// ── The flow ─────────────────────────────────────────────────────────────────

/**
 * Uploads one file and returns only what the server verified.
 *
 * Resolves ⇔ the object is in the bucket and the API confirmed its size. Every
 * other outcome throws a MediaUploadError. There is no partial success and no
 * "probably uploaded" — those were the states the previous stub reported.
 */
export async function uploadMediaFile(params: {
  file: File;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<VerifiedUpload> {
  const { file, signal } = params;
  const totalBytes = file.size;

  const report = (phase: UploadPhase, loadedBytes: number) =>
    params.onProgress?.({
      phase,
      loadedBytes,
      totalBytes,
      percent: totalBytes > 0 ? Math.min(100, Math.floor((loadedBytes / totalBytes) * 100)) : 0,
    });

  throwIfAborted(signal);

  if (totalBytes === 0) {
    throw new MediaUploadError('FILE_UNREADABLE', 'الملف فارغ (0 بايت) — لا شيء لرفعه');
  }

  const rule = resolveClientRule(file);
  if (!rule) {
    throw new MediaUploadError(
      'UNSUPPORTED_MEDIA_TYPE',
      `نوع الملف غير مسموح. الأنواع المقبولة: ${ALLOWED_TYPES_AR}. (لا يُقبل الفيديو — ميثاق المنصة §3.2)`,
    );
  }

  if (totalBytes > rule.maxBytes) {
    throw new MediaUploadError(
      'FILE_TOO_LARGE',
      `${rule.labelAr}: حجم الملف ${formatBytesAr(totalBytes)} والحد الأقصى لهذا النوع ` +
        `${formatBytesAr(rule.maxBytes)}`,
    );
  }

  // 1 ── Hash. Before initiate, because the digest is part of the object key.
  report('HASHING', 0);
  const sha256 = await computeSha256Hex(file, (loaded) => report('HASHING', loaded), signal);

  // 2 ── Ask the API for a credential bound to this exact file.
  const ticket = await initiate({
    fileName: file.name,
    mimeType: rule.mimeType,
    sizeBytes: totalBytes,
    sha256,
  });

  report('UPLOADING', 0);

  const uploadedParts: Array<{ partNumber: number; etag: string }> = [];

  if (ticket.mode === 'SINGLE') {
    const outcome = await putBlob({
      url: ticket.uploadUrl,
      // Re-typed with the signed content type: an empty or wrong `File.type`
      // would otherwise make the browser send a Content-Type that is not the one
      // inside the signature.
      body: new Blob([file], { type: rule.mimeType }),
      headers: ticket.requiredHeaders ?? {},
      onProgress: (loaded) => report('UPLOADING', loaded),
      signal,
    });

    if (outcome.status < 200 || outcome.status >= 300) {
      throw describeStorageRejection(outcome, 'رفع الملف');
    }
  } else {
    // Sequential on purpose. Parallel parts would finish sooner on a fast link,
    // but they make progress reporting and cancellation harder to get right, and
    // a wrong progress bar is a small lie of exactly the kind this module exists
    // to avoid. Concurrency is a later optimisation, not a Stage A requirement.
    let uploadedBytes = 0;
    let offset = 0;

    for (const part of ticket.parts) {
      throwIfAborted(signal);

      const end = Math.min(offset + part.contentLength, totalBytes);
      const blob = file.slice(offset, end);

      if (blob.size !== part.contentLength) {
        throw new MediaUploadError(
          'FILE_UNREADABLE',
          `تغيّر حجم الملف أثناء الرفع: الجزء ${part.partNumber} يجب أن يكون ` +
            `${blob.size} بايت بدل ${part.contentLength}. أعد اختيار الملف وابدأ من جديد.`,
        );
      }

      const startedAt = uploadedBytes;
      const outcome = await putBlob({
        url: part.url,
        body: blob,
        // Only content-length is signed for a part URL (see the adapter), and the
        // browser sets that itself. Any extra header here would be unsigned noise.
        headers: {},
        onProgress: (loaded) => report('UPLOADING', startedAt + loaded),
        signal,
      });

      if (outcome.status < 200 || outcome.status >= 300) {
        throw describeStorageRejection(outcome, `الجزء ${part.partNumber}`);
      }

      if (!outcome.etag) {
        // Never invented. Storage recorded a real ETag for this part; the browser
        // just is not allowed to read it, and that is a fixable server setting.
        throw new MediaUploadError(
          'ETAG_NOT_EXPOSED',
          `تم رفع الجزء ${part.partNumber} لكن المتصفح لا يستطيع قراءة ترويسة ETag الخاصة به، ` +
            'وهي مطلوبة لتجميع الملف. أضف ETag إلى ExposeHeaders في إعداد CORS لخدمة التخزين ' +
            '(MinIO/R2) ثم أعد المحاولة. لن يُجمَّع الملف ببيانات مُفترضة.',
        );
      }

      uploadedParts.push({ partNumber: part.partNumber, etag: outcome.etag });
      uploadedBytes += blob.size;
      offset = end;
      report('UPLOADING', uploadedBytes);
    }
  }

  // 3 ── Let the server verify against storage. This is the only source of truth.
  report('VERIFYING', totalBytes);
  const verified = await complete({
    uploadId: ticket.uploadId,
    ...(uploadedParts.length > 0 ? { parts: uploadedParts } : {}),
  });

  if (verified.uploadStatus !== 'UPLOADED') {
    throw new MediaUploadError(
      'VERIFICATION_INCOMPLETE',
      `لم يؤكّد الخادم وصول الملف إلى التخزين (الحالة: ${verified.uploadStatus}). ` +
        'لم يُسجَّل الملف كمرفوع.',
    );
  }

  if (!verified.mediaAssetId) {
    // Without an id there is nothing to attach to a content item. Returning here
    // would hand the form `undefined` under a success banner — the failure mode
    // this whole module is built to prevent.
    throw new MediaUploadError(
      'VERIFICATION_INCOMPLETE',
      'أكّد الخادم الرفع لكنه لم يُعِد معرّف الملف، فلا يمكن ربطه بالمادة',
    );
  }

  if (verified.verifiedBytes !== totalBytes) {
    throw new MediaUploadError(
      'VERIFICATION_INCOMPLETE',
      `عدد البايتات التي تحقّق منها الخادم (${verified.verifiedBytes ?? 'غير معروف'}) ` +
        `لا يساوي حجم الملف (${totalBytes}). لم يُعتمد الرفع.`,
    );
  }

  if (verified.sha256 && verified.sha256 !== sha256) {
    // Would mean the row we completed is not the row we initiated.
    throw new MediaUploadError(
      'VERIFICATION_INCOMPLETE',
      'بصمة الملف المسجّلة على الخادم لا تطابق البصمة المحسوبة محلياً — لم يُعتمد الرفع',
    );
  }

  return {
    mediaAssetId: verified.mediaAssetId,
    verifiedBytes: verified.verifiedBytes,
    sha256,
    uploadStatus: 'UPLOADED',
    transcodeStatus: verified.transcodeStatus,
    transcodeNote: verified.transcodeNote,
    fileName: file.name,
    mimeType: rule.mimeType,
    mode: ticket.mode,
  };
}
