/**
 * MediaAsset Domain Entity — BC02
 *
 * Tracks uploaded media (AUDIO/PDF/IMAGE — NO VIDEO per Charter §3.2).
 * cdn_url: public assets only (IMAGE thumbnails).
 * Protected AUDIO/PDF content uses Presigned URLs — never a permanent cdn_url.
 *
 * TWO INDEPENDENT LIFECYCLES (ADR-013 §3, migration 015):
 *
 *   uploadStatus    PENDING_UPLOAD → UPLOADED | ABORTED
 *   transcodeStatus PENDING → PROCESSING → DONE | FAILED
 *
 * They were previously collapsed into `transcodeStatus`, and the upload-complete
 * endpoint set it to DONE without checking storage at all (TECH-DEBT-014,
 * POLICY-SEC-001 categories 3 and 4). With one column there was no way to say
 * "the bytes are really in the bucket, and no transcoding has happened" — so the
 * code said something untrue instead.
 *
 * ADR-013 Stage B (BullMQ + ffmpeg/sharp) IS NOT IMPLEMENTED. There is therefore
 * deliberately no method on this entity that can set `transcodeStatus` to
 * anything but PENDING. `markDone()` was removed rather than left unused: an
 * available method that fabricates completion is how TECH-DEBT-014 happened in
 * the first place. Stage B will add `startTranscoding()` / `completeTranscoding()`
 * guarded on `uploadStatus === 'UPLOADED'`.
 */
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export type TranscodeStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'DONE'
  | 'FAILED'
  // ADR-013 Stage B (BullMQ) — added by migration 016
  | 'QUEUED'
  | 'TRANSCODING'
  | 'TRANSCODED'
  | 'TRANSCODE_FAILED';
export type UploadStatus = 'PENDING_UPLOAD' | 'UPLOADED' | 'ABORTED';

/**
 * Proof, read back FROM STORAGE, that an upload actually happened.
 *
 * The type exists so that "confirm this upload" is impossible to call without
 * evidence. A boolean flag or a bare `confirmUpload()` would be satisfiable by a
 * caller that never talked to storage; this is not.
 */
export interface UploadEvidence {
  /** ContentLength returned by headObject — not the client's declared size. */
  verifiedBytes: number;
  verifiedAt: Date;
}

export class MediaAsset {
  private constructor(
    public readonly id: UUIDv7,
    private _originalName: string,
    private _storageKey: string,
    private _cdnUrl: string | null,
    private _mimeType: string,
    private _sizeBytes: number,
    private _durationMs: number | null,
    private _pageCount: number | null,
    private _widthPx: number | null,
    private _heightPx: number | null,
    private _thumbnailKey: string | null,
    private _transcodeStatus: TranscodeStatus,
    private _transcodeError: string | null,
    private _uploadStatus: UploadStatus,
    private _sha256: string | null,
    private _verifiedBytes: number | null,
    private _uploadedAt: Date | null,
    private _multipartUploadId: string | null,
    private _uploadError: string | null,
    public readonly uploadedBy: string,
    private _deletedAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * Creates the asset row at the moment a presigned URL is issued — i.e. BEFORE
   * any byte exists in storage. `uploadStatus` is PENDING_UPLOAD and there is no
   * way to construct this entity in an already-UPLOADED state.
   *
   * `sizeBytes` and `sha256` are what the CLIENT DECLARED. They are not facts
   * yet; they become the expectation that storage is later held to.
   */
  static create(params: {
    id: UUIDv7;
    originalName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedBy: string;
    multipartUploadId?: string | null;
  }): MediaAsset {
    const now = new Date();
    return new MediaAsset(
      params.id, params.originalName, params.storageKey,
      null, params.mimeType, params.sizeBytes,
      null, null, null, null, null,
      'PENDING', null,
      'PENDING_UPLOAD', params.sha256, null, null,
      params.multipartUploadId ?? null, null,
      params.uploadedBy, null, now, now,
    );
  }

  static reconstitute(params: {
    id: string;
    originalName: string;
    storageKey: string;
    cdnUrl: string | null;
    mimeType: string;
    sizeBytes: number;
    durationMs: number | null;
    pageCount: number | null;
    widthPx: number | null;
    heightPx: number | null;
    thumbnailKey: string | null;
    transcodeStatus: TranscodeStatus;
    transcodeError: string | null;
    uploadStatus: UploadStatus;
    sha256: string | null;
    verifiedBytes: number | null;
    uploadedAt: Date | null;
    multipartUploadId: string | null;
    uploadError: string | null;
    uploadedBy: string;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): MediaAsset {
    return new MediaAsset(
      UUIDv7.fromString(params.id),
      params.originalName, params.storageKey, params.cdnUrl,
      params.mimeType, params.sizeBytes, params.durationMs,
      params.pageCount, params.widthPx, params.heightPx,
      params.thumbnailKey, params.transcodeStatus, params.transcodeError,
      params.uploadStatus, params.sha256, params.verifiedBytes,
      params.uploadedAt, params.multipartUploadId, params.uploadError,
      params.uploadedBy, params.deletedAt, params.createdAt, params.updatedAt,
    );
  }

  get originalName(): string { return this._originalName; }
  get storageKey(): string { return this._storageKey; }
  get cdnUrl(): string | null { return this._cdnUrl; }
  get mimeType(): string { return this._mimeType; }
  get sizeBytes(): number { return this._sizeBytes; }
  get durationMs(): number | null { return this._durationMs; }
  get pageCount(): number | null { return this._pageCount; }
  get widthPx(): number | null { return this._widthPx; }
  get heightPx(): number | null { return this._heightPx; }
  get thumbnailKey(): string | null { return this._thumbnailKey; }
  get transcodeStatus(): TranscodeStatus { return this._transcodeStatus; }
  get transcodeError(): string | null { return this._transcodeError; }
  get uploadStatus(): UploadStatus { return this._uploadStatus; }
  get sha256(): string | null { return this._sha256; }
  get verifiedBytes(): number | null { return this._verifiedBytes; }
  get uploadedAt(): Date | null { return this._uploadedAt; }
  get multipartUploadId(): string | null { return this._multipartUploadId; }
  get uploadError(): string | null { return this._uploadError; }
  get deletedAt(): Date | null { return this._deletedAt; }
  get updatedAt(): Date { return this._updatedAt; }

  /** True only when storage has been confirmed to hold the object. */
  get isUploaded(): boolean { return this._uploadStatus === 'UPLOADED'; }

  /**
   * Records that storage was checked and really holds this object.
   *
   * Throws unless the evidence matches the declared size. The comparison lives
   * here, in the aggregate, so that NO caller — present or future — can mark an
   * asset UPLOADED with the wrong bytes, even by mistake. Together with the DB
   * CHECK constraint from migration 015 this is defence in depth around the one
   * transition that TECH-DEBT-014 got wrong.
   */
  confirmUpload(evidence: UploadEvidence): void {
    if (this._uploadStatus === 'ABORTED') {
      throw new Error(
        `Media asset ${this.id.value} was aborted and cannot be confirmed; start a new upload`,
      );
    }
    if (evidence.verifiedBytes !== this._sizeBytes) {
      throw new Error(
        `Refusing to confirm media asset ${this.id.value}: storage holds ` +
          `${evidence.verifiedBytes} bytes but ${this._sizeBytes} were declared`,
      );
    }

    this._uploadStatus = 'UPLOADED';
    this._verifiedBytes = evidence.verifiedBytes;
    this._uploadedAt = evidence.verifiedAt;
    this._uploadError = null;
    this._multipartUploadId = null; // the multipart session is finished
    this._updatedAt = new Date();
    // transcodeStatus deliberately untouched: it stays PENDING because ADR-013
    // Stage B does not exist. A verified upload is not a processed file.
  }

  /**
   * Records that the upload did not happen, or did not survive verification.
   * The reason is stored and shown to the editor — never swallowed, and never
   * replaced by a success message.
   */
  abortUpload(reason: string): void {
    this._uploadStatus = 'ABORTED';
    this._uploadError = reason;
    this._verifiedBytes = null;
    this._uploadedAt = null;
    this._updatedAt = new Date();
  }

  /** Records the storage-side multipart session id, for later completion or abort. */
  attachMultipartUpload(uploadId: string): void {
    this._multipartUploadId = uploadId;
    this._updatedAt = new Date();
  }

  softDelete(): void {
    this._deletedAt = new Date();
    this._updatedAt = new Date();
  }
}
