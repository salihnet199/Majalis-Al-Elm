/**
 * ContentItem Aggregate Root — BC02: Content & Media Library
 *
 * ZERO dependency on TypeORM, NestJS, or any infrastructure concern (P-06).
 *
 * Content types: AUDIO | PDF | TEXT | IMAGE — NO VIDEO (Charter §3.2, DB-SCHEMA §BC02)
 * TEXT type: body is stored in ct_translations(field_name='body') — no media_asset_id
 * AUDIO/PDF/IMAGE: media_asset_id references ct_media_assets
 *
 * Workflow: DRAFT → REVIEW → PUBLISHED → ARCHIVED
 */

import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export type ContentType = 'AUDIO' | 'PDF' | 'TEXT' | 'IMAGE';
export type ContentStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';

export class ContentItem {
  private constructor(
    public readonly id: UUIDv7,
    private _slug: string,
    private _type: ContentType,
    private _status: ContentStatus,
    private _primaryLocale: string,
    private _authorId: string | null,
    private _categoryId: string | null,
    private _mediaAssetId: string | null,
    private _viewCount: number,
    private _sortOrder: number,
    private _isFeatured: boolean,
    private _publishedAt: Date | null,
    private _scheduledAt: Date | null,
    public readonly createdBy: string,
    private _lastEditedBy: string | null,
    private _deletedAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // ── Factory Methods ──────────────────────────────────────────────────────────

  static create(params: {
    id: UUIDv7;
    slug: string;
    type: ContentType;
    primaryLocale?: string;
    authorId?: string | null;
    categoryId?: string | null;
    mediaAssetId?: string | null;
    sortOrder?: number;
    isFeatured?: boolean;
    scheduledAt?: Date | null;
    createdBy: string;
  }): ContentItem {
    const now = new Date();
    return new ContentItem(
      params.id,
      params.slug,
      params.type,
      'DRAFT',
      params.primaryLocale ?? 'ar',
      params.authorId ?? null,
      params.categoryId ?? null,
      params.mediaAssetId ?? null,
      0,
      params.sortOrder ?? 0,
      params.isFeatured ?? false,
      null,
      params.scheduledAt ?? null,
      params.createdBy,
      null,
      null,
      now,
      now,
    );
  }

  static reconstitute(params: {
    id: string;
    slug: string;
    type: ContentType;
    status: ContentStatus;
    primaryLocale: string;
    authorId: string | null;
    categoryId: string | null;
    mediaAssetId: string | null;
    viewCount: number;
    sortOrder: number;
    isFeatured: boolean;
    publishedAt: Date | null;
    scheduledAt: Date | null;
    createdBy: string;
    lastEditedBy: string | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ContentItem {
    return new ContentItem(
      UUIDv7.fromString(params.id),
      params.slug,
      params.type,
      params.status,
      params.primaryLocale,
      params.authorId,
      params.categoryId,
      params.mediaAssetId,
      params.viewCount,
      params.sortOrder,
      params.isFeatured,
      params.publishedAt,
      params.scheduledAt,
      params.createdBy,
      params.lastEditedBy,
      params.deletedAt,
      params.createdAt,
      params.updatedAt,
    );
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  get slug(): string { return this._slug; }
  get type(): ContentType { return this._type; }
  get status(): ContentStatus { return this._status; }
  get primaryLocale(): string { return this._primaryLocale; }
  get authorId(): string | null { return this._authorId; }
  get categoryId(): string | null { return this._categoryId; }
  get mediaAssetId(): string | null { return this._mediaAssetId; }
  get viewCount(): number { return this._viewCount; }
  get sortOrder(): number { return this._sortOrder; }
  get isFeatured(): boolean { return this._isFeatured; }
  get publishedAt(): Date | null { return this._publishedAt; }
  get scheduledAt(): Date | null { return this._scheduledAt; }
  get lastEditedBy(): string | null { return this._lastEditedBy; }
  get deletedAt(): Date | null { return this._deletedAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get isDeleted(): boolean { return this._deletedAt !== null; }

  // ── Domain Behaviour ─────────────────────────────────────────────────────────

  update(params: {
    authorId?: string | null;
    categoryId?: string | null;
    mediaAssetId?: string | null;
    sortOrder?: number;
    isFeatured?: boolean;
    scheduledAt?: Date | null;
    editedBy: string;
  }): void {
    if (params.authorId !== undefined)     this._authorId = params.authorId;
    if (params.categoryId !== undefined)   this._categoryId = params.categoryId;
    if (params.mediaAssetId !== undefined) this._mediaAssetId = params.mediaAssetId;
    if (params.sortOrder !== undefined)    this._sortOrder = params.sortOrder;
    if (params.isFeatured !== undefined)   this._isFeatured = params.isFeatured;
    if (params.scheduledAt !== undefined)  this._scheduledAt = params.scheduledAt;
    this._lastEditedBy = params.editedBy;
    this._updatedAt = new Date();
  }

  submitForReview(): void {
    if (this._status !== 'DRAFT') {
      throw new Error(`Cannot submit for review: current status is '${this._status}', expected 'DRAFT'`);
    }
    this._status = 'REVIEW';
    this._updatedAt = new Date();
  }

  publish(): void {
    if (this._status !== 'REVIEW') {
      throw new Error(`Cannot publish: current status is '${this._status}', expected 'REVIEW'`);
    }
    this._status = 'PUBLISHED';
    this._publishedAt = new Date();
    this._updatedAt = new Date();
  }

  archive(): void {
    if (this._status !== 'PUBLISHED') {
      throw new Error(`Cannot archive: current status is '${this._status}', expected 'PUBLISHED'`);
    }
    this._status = 'ARCHIVED';
    this._updatedAt = new Date();
  }

  softDelete(): void {
    this._deletedAt = new Date();
    this._updatedAt = new Date();
  }

  incrementViewCount(): void {
    this._viewCount += 1;
    this._updatedAt = new Date();
  }
}
