import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { webcrypto } from 'node:crypto';

/**
 * ADR-013 Stage A / POLICY-SEC-001 regression suite for the browser uploader.
 *
 * The media flow it replaced reported success without moving a byte: `initiate`
 * answered `presignedUrl: null`, nothing was uploaded, and the UI showed a green
 * toast. So these tests are not about upload mechanics — they are about the four
 * points where this module could tell a convenient lie, and each one asserts the
 * lie is a thrown error instead:
 *
 *   1. no digest ⇒ no upload            (crypto.subtle missing)
 *   2. no readable ETag ⇒ no assembly   (CORS ExposeHeaders)
 *   3. no server confirmation ⇒ no success
 *   4. transcodeStatus is passed through, never upgraded to DONE
 */

vi.mock('../core/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { apiClient } from '../core/api/client';
import { MediaUploadError, uploadMediaFile } from '../core/api/mediaUpload';

// ── Fakes ────────────────────────────────────────────────────────────────────

const FILL_BYTE = 7;

/**
 * A File stand-in. jsdom cannot hold a 300 MB File, and the module only uses
 * `name`, `type`, `size` and `slice()`, so the fake declares a size and serves
 * matching bytes — which is also what lets a "the file shrank" case be simulated.
 */
function fakeFile(options: { name: string; type: string; size: number }): File {
  const { name, type, size } = options;
  return {
    name,
    type,
    size,
    slice: (start = 0, end = size) => {
      const length = Math.max(0, Math.min(end, size) - start);
      return {
        size: length,
        arrayBuffer: async () => new Uint8Array(length).fill(FILL_BYTE).buffer,
      };
    },
  } as unknown as File;
}

async function sha256HexOf(size: number): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new Uint8Array(size).fill(FILL_BYTE));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface XhrBehavior {
  status?: number;
  etag?: string | null;
  body?: string;
}

class FakeXhr {
  static behavior: XhrBehavior = {};
  static sent: Array<{ url: string; headers: Record<string, string> }> = [];

  status = 0;
  responseText = '';
  upload: { onprogress?: (event: { loaded: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;

  private url = '';
  private headers: Record<string, string> = {};

  open(_method: string, url: string) {
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    if (name.toLowerCase() !== 'etag') return null;
    return FakeXhr.behavior.etag ?? null;
  }

  send() {
    FakeXhr.sent.push({ url: this.url, headers: this.headers });
    setTimeout(() => {
      this.status = FakeXhr.behavior.status ?? 200;
      this.responseText = FakeXhr.behavior.body ?? '';
      this.upload.onprogress?.({ loaded: 1 });
      this.onload?.();
    }, 0);
  }

  abort() {
    this.onabort?.();
  }
}

const originalCrypto = globalThis.crypto;
const originalXhr = globalThis.XMLHttpRequest;

beforeEach(() => {
  vi.clearAllMocks();
  FakeXhr.behavior = {};
  FakeXhr.sent = [];
  // jsdom's `crypto` has no `subtle`; the real WebCrypto is what the module is
  // supposed to use, so the tests give it the real one.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  globalThis.XMLHttpRequest = originalXhr;
});

/** Wires initiate/complete responses onto the mocked axios client. */
function mockApi(responses: { initiate?: unknown; complete?: unknown; initiateError?: unknown }) {
  (apiClient.post as Mock).mockImplementation(async (url: string) => {
    if (url.endsWith('/upload/initiate')) {
      if (responses.initiateError) throw responses.initiateError;
      return { data: { data: responses.initiate } };
    }
    if (url.endsWith('/upload/complete')) {
      return { data: { data: responses.complete } };
    }
    throw new Error(`unexpected POST ${url}`);
  });
}

const singleTicket = (overrides: Record<string, unknown> = {}) => ({
  uploadId: 'upl-1',
  mode: 'SINGLE',
  storageKey: 'originals/m1/abc.mp3',
  uploadUrl: 'http://localhost:9000/majalis-elm-media/originals/m1/abc.mp3?X-Amz-Signature=x',
  requiredHeaders: { 'content-type': 'audio/mpeg', 'x-amz-checksum-sha256': 'base64==' },
  expiresAt: new Date(0).toISOString(),
  ...overrides,
});

// ── 1. No digest ⇒ no upload ─────────────────────────────────────────────────

describe('POLICY-SEC-001: the SHA-256 is never fabricated', () => {
  it('fails loudly when crypto.subtle is unavailable, without contacting the API', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });

    const error = await uploadMediaFile({
      file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size: 64 }),
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MediaUploadError);
    expect((error as MediaUploadError).code).toBe('CRYPTO_UNAVAILABLE');
    // The message has to be actionable: this is a deployment mistake with one fix.
    expect((error as MediaUploadError).message).toContain('https');
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it('sends the real digest of the real bytes to initiate', async () => {
    const size = 4096;
    mockApi({
      initiate: singleTicket(),
      complete: {
        mediaAssetId: 'media-1',
        uploadStatus: 'UPLOADED',
        verifiedBytes: size,
        sha256: await sha256HexOf(size),
        uploadedAt: new Date(0).toISOString(),
        alreadyComplete: false,
        transcodeStatus: 'PENDING',
      },
    });

    await uploadMediaFile({ file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size }) });

    const initiateBody = (apiClient.post as Mock).mock.calls[0][1];
    expect(initiateBody.sha256).toBe(await sha256HexOf(size));
    expect(initiateBody.sizeBytes).toBe(size);
    expect(initiateBody.mimeType).toBe('audio/mpeg');
  });
});

// ── Policy mirror: rejected before any network call ──────────────────────────

describe('client-side policy refusals', () => {
  it('refuses video outright (platform charter §3.2)', async () => {
    const error = await uploadMediaFile({
      file: fakeFile({ name: 'khutbah.mkv', type: 'video/x-matroska', size: 1024 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses an image above the 10 MB cap the sponsor set', async () => {
    const error = await uploadMediaFile({
      file: fakeFile({ name: 'scan.png', type: 'image/png', size: 11 * 1024 * 1024 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('FILE_TOO_LARGE');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses an empty file instead of uploading zero bytes', async () => {
    const error = await uploadMediaFile({
      file: fakeFile({ name: 'empty.pdf', type: 'application/pdf', size: 0 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('FILE_UNREADABLE');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('resolves the type from the extension when the browser reports none', async () => {
    // Windows reports an empty File.type for .m4a; the declared type is signed, so
    // guessing wrong here produces a 403 from storage instead of a message.
    const size = 128;
    mockApi({
      initiate: singleTicket(),
      complete: {
        mediaAssetId: 'media-2',
        uploadStatus: 'UPLOADED',
        verifiedBytes: size,
        sha256: null,
        uploadedAt: null,
        alreadyComplete: false,
        transcodeStatus: 'PENDING',
      },
    });

    await uploadMediaFile({ file: fakeFile({ name: 'darс.m4a', type: '', size }) });

    expect((apiClient.post as Mock).mock.calls[0][1].mimeType).toBe('audio/mp4');
  });
});

// ── 2. The stub's own failure shape ──────────────────────────────────────────

describe('POLICY-SEC-001: a missing signed URL is a failure, not a success', () => {
  it('throws INITIATE_FAILED when the server returns no uploadUrl (the old stub)', async () => {
    mockApi({ initiate: singleTicket({ uploadUrl: null }) });

    const error = await uploadMediaFile({
      file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size: 32 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('INITIATE_FAILED');
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it('throws INITIATE_FAILED when a multipart ticket carries no parts', async () => {
    mockApi({ initiate: { uploadId: 'upl-2', mode: 'MULTIPART', parts: [] } });

    const error = await uploadMediaFile({
      file: fakeFile({ name: 'long.mp3', type: 'audio/mpeg', size: 32 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('INITIATE_FAILED');
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it('surfaces the storage service’s own rejection code', async () => {
    mockApi({ initiate: singleTicket() });
    FakeXhr.behavior = {
      status: 403,
      body: '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code></Error>',
    };

    const error = await uploadMediaFile({
      file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size: 32 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('STORAGE_REJECTED');
    expect((error as MediaUploadError).message).toContain('403');
    expect((error as MediaUploadError).message).toContain('SignatureDoesNotMatch');
    // Nothing was confirmed, so `complete` must not have been called.
    expect((apiClient.post as Mock).mock.calls.map((c) => c[0])).not.toContain(
      '/admin/media/upload/complete',
    );
  });
});

// ── 3. Success is only what the server confirmed ─────────────────────────────

describe('POLICY-SEC-001: success is the server’s verdict, not the client’s hope', () => {
  const baseComplete = {
    mediaAssetId: 'media-9',
    uploadStatus: 'UPLOADED',
    verifiedBytes: 32,
    sha256: null as string | null,
    uploadedAt: null,
    alreadyComplete: false,
    transcodeStatus: 'PENDING',
  };

  const run = () =>
    uploadMediaFile({ file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size: 32 }) });

  it('rejects when the server still reports the upload as pending', async () => {
    mockApi({ initiate: singleTicket(), complete: { ...baseComplete, uploadStatus: 'PENDING_UPLOAD' } });

    const error = await run().catch((e) => e);
    expect((error as MediaUploadError).code).toBe('VERIFICATION_INCOMPLETE');
    expect((error as MediaUploadError).message).toContain('PENDING_UPLOAD');
  });

  it('rejects when the verified byte count differs from the file size', async () => {
    mockApi({ initiate: singleTicket(), complete: { ...baseComplete, verifiedBytes: 31 } });

    const error = await run().catch((e) => e);
    expect((error as MediaUploadError).code).toBe('VERIFICATION_INCOMPLETE');
    // Both numbers appear, so the report is diagnosable rather than decorative.
    expect((error as MediaUploadError).message).toContain('31');
    expect((error as MediaUploadError).message).toContain('32');
  });

  it('rejects when the server reports no verified byte count at all', async () => {
    mockApi({ initiate: singleTicket(), complete: { ...baseComplete, verifiedBytes: null } });

    const error = await run().catch((e) => e);
    expect((error as MediaUploadError).code).toBe('VERIFICATION_INCOMPLETE');
  });

  it('rejects when the server’s recorded digest is not the one computed locally', async () => {
    mockApi({ initiate: singleTicket(), complete: { ...baseComplete, sha256: 'deadbeef' } });

    const error = await run().catch((e) => e);
    expect((error as MediaUploadError).code).toBe('VERIFICATION_INCOMPLETE');
  });

  it('rejects when the confirmation carries no media asset id', async () => {
    mockApi({ initiate: singleTicket(), complete: { ...baseComplete, mediaAssetId: '' } });

    const error = await run().catch((e) => e);
    expect((error as MediaUploadError).code).toBe('VERIFICATION_INCOMPLETE');
  });

  it('rejects an unparseable confirmation instead of assuming it worked', async () => {
    mockApi({ initiate: singleTicket(), complete: undefined });

    const error = await run().catch((e) => e);
    expect((error as MediaUploadError).code).toBe('COMPLETE_FAILED');
  });

  it('returns the verified upload, with transcodeStatus passed through untouched', async () => {
    const size = 32;
    mockApi({
      initiate: singleTicket(),
      complete: { ...baseComplete, verifiedBytes: size, sha256: await sha256HexOf(size), transcodeStatus: 'PENDING' },
    });

    const phases: string[] = [];
    const result = await uploadMediaFile({
      file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size }),
      onProgress: (p) => phases.push(p.phase),
    });

    expect(result.uploadStatus).toBe('UPLOADED');
    expect(result.verifiedBytes).toBe(size);
    expect(result.mediaAssetId).toBe('media-9');
    expect(result.mode).toBe('SINGLE');
    // ADR-013 Stage B does not exist. Nothing in this path may promote PENDING.
    expect(result.transcodeStatus).toBe('PENDING');
    expect(phases).toContain('HASHING');
    expect(phases).toContain('UPLOADING');
    expect(phases).toContain('VERIFYING');
  });

  it('sends the signed headers to storage but never Content-Length', async () => {
    const size = 32;
    mockApi({
      initiate: singleTicket(),
      complete: { ...baseComplete, verifiedBytes: size, sha256: await sha256HexOf(size) },
    });

    await uploadMediaFile({ file: fakeFile({ name: 'lesson.mp3', type: 'audio/mpeg', size }) });

    const sent = FakeXhr.sent[0];
    expect(sent.headers['content-type']).toBe('audio/mpeg');
    expect(sent.headers['x-amz-checksum-sha256']).toBe('base64==');
    // Forbidden header name: the browser computes it, which is exactly why the
    // server signs it. Setting it here would only produce a console warning.
    expect(Object.keys(sent.headers).map((k) => k.toLowerCase())).not.toContain('content-length');
  });
});

// ── 4. No invented ETags ─────────────────────────────────────────────────────

describe('POLICY-SEC-001: multipart ETags come from storage or the upload fails', () => {
  const multipartTicket = {
    uploadId: 'upl-mp',
    mode: 'MULTIPART',
    storageKey: 'originals/m3/abc.mp3',
    partSizeBytes: 8,
    parts: [
      { partNumber: 1, url: 'http://localhost:9000/part-1', contentLength: 8 },
      { partNumber: 2, url: 'http://localhost:9000/part-2', contentLength: 4 },
    ],
    expiresAt: new Date(0).toISOString(),
  };

  it('throws ETAG_NOT_EXPOSED with the CORS fix, and does not call complete', async () => {
    mockApi({ initiate: multipartTicket, complete: undefined });
    FakeXhr.behavior = { status: 200, etag: null };

    const error = await uploadMediaFile({
      file: fakeFile({ name: 'long.mp3', type: 'audio/mpeg', size: 12 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('ETAG_NOT_EXPOSED');
    expect((error as MediaUploadError).message).toContain('ExposeHeaders');
    expect((apiClient.post as Mock).mock.calls.map((c) => c[0])).not.toContain(
      '/admin/media/upload/complete',
    );
  });

  it('forwards the real per-part ETags to complete', async () => {
    const size = 12;
    mockApi({
      initiate: multipartTicket,
      complete: {
        mediaAssetId: 'media-mp',
        uploadStatus: 'UPLOADED',
        verifiedBytes: size,
        sha256: null,
        uploadedAt: null,
        alreadyComplete: false,
        transcodeStatus: 'PENDING',
      },
    });
    FakeXhr.behavior = { status: 200, etag: '"etag-from-storage"' };

    const result = await uploadMediaFile({
      file: fakeFile({ name: 'long.mp3', type: 'audio/mpeg', size }),
    });

    const completeCall = (apiClient.post as Mock).mock.calls.find((c) =>
      String(c[0]).endsWith('/upload/complete'),
    );
    expect(completeCall?.[1].parts).toEqual([
      { partNumber: 1, etag: '"etag-from-storage"' },
      { partNumber: 2, etag: '"etag-from-storage"' },
    ]);
    expect(result.mode).toBe('MULTIPART');
    expect(FakeXhr.sent).toHaveLength(2);
  });

  it('stops when a part’s length does not match what was signed', async () => {
    // The file changed under the upload: sending 4 bytes against a signature for 8
    // would 403, and assembling the object from mismatched parts would corrupt it.
    mockApi({
      initiate: {
        ...multipartTicket,
        parts: [{ partNumber: 1, url: 'http://localhost:9000/part-1', contentLength: 8 }],
      },
    });

    const error = await uploadMediaFile({
      file: fakeFile({ name: 'long.mp3', type: 'audio/mpeg', size: 4 }),
    }).catch((e) => e);

    expect((error as MediaUploadError).code).toBe('FILE_UNREADABLE');
    expect(FakeXhr.sent).toHaveLength(0);
  });
});
