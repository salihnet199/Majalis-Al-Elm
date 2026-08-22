/**
 * Author Domain Entity — BC02
 *
 * Independent entity — NO FK to id_users (per decision 2, YAGNI).
 * A linked_user_id field may be added in a future phase if authors need
 * to be associated with Editor accounts.
 */
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export class Author {
  private constructor(
    public readonly id: UUIDv7,
    private _slug: string,
    private _avatarUrl: string | null,
    private _sortOrder: number,
    private _deletedAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(params: {
    id: UUIDv7;
    slug: string;
    avatarUrl?: string | null;
    sortOrder?: number;
  }): Author {
    const now = new Date();
    return new Author(
      params.id,
      params.slug,
      params.avatarUrl ?? null,
      params.sortOrder ?? 0,
      null,
      now,
      now,
    );
  }

  static reconstitute(params: {
    id: string;
    slug: string;
    avatarUrl: string | null;
    sortOrder: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Author {
    return new Author(
      UUIDv7.fromString(params.id),
      params.slug,
      params.avatarUrl,
      params.sortOrder,
      params.deletedAt,
      params.createdAt,
      params.updatedAt,
    );
  }

  get slug(): string { return this._slug; }
  get avatarUrl(): string | null { return this._avatarUrl; }
  get sortOrder(): number { return this._sortOrder; }
  get deletedAt(): Date | null { return this._deletedAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get isDeleted(): boolean { return this._deletedAt !== null; }

  update(params: { avatarUrl?: string | null; sortOrder?: number }): void {
    if (params.avatarUrl !== undefined) this._avatarUrl = params.avatarUrl;
    if (params.sortOrder !== undefined) this._sortOrder = params.sortOrder;
    this._updatedAt = new Date();
  }

  softDelete(): void {
    this._deletedAt = new Date();
    this._updatedAt = new Date();
  }
}
