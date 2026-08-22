/**
 * MediaAsset Domain Entity — BC02
 *
 * Tracks uploaded media (AUDIO/PDF/IMAGE — NO VIDEO per Charter §3.2).
 * cdn_url: public assets only (IMAGE thumbnails).
 * Protected AUDIO/PDF content uses Presigned URLs — never a permanent cdn_url.
 */
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export type TranscodeStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

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
    public readonly uploadedBy: string,
    private _deletedAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(params: {
    id: UUIDv7;
    originalName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
  }): MediaAsset {
    const now = new Date();
    return new MediaAsset(
      params.id, params.originalName, params.storageKey,
      null, params.mimeType, params.sizeBytes,
      null, null, null, null, null,
      'PENDING', null, params.uploadedBy, null, now, now,
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
  get deletedAt(): Date | null { return this._deletedAt; }
  get updatedAt(): Date { return this._updatedAt; }

  markDone(): void {
    this._transcodeStatus = 'DONE';
    this._updatedAt = new Date();
  }

  markFailed(error: string): void {
    this._transcodeStatus = 'FAILED';
    this._transcodeError = error;
    this._updatedAt = new Date();
  }
}
