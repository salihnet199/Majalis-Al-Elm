/**
 * Category Domain Entity — BC02
 *
 * Adjacency List tree via parent_id (DB-003, 2026-08-09).
 * NO lft / rgt / depth columns — simple self-referencing parent.
 */
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export class Category {
  private constructor(
    public readonly id: UUIDv7,
    private _slug: string,
    private _parentId: string | null,
    private _sortOrder: number,
    private _deletedAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(params: {
    id: UUIDv7;
    slug: string;
    parentId?: string | null;
    sortOrder?: number;
  }): Category {
    const now = new Date();
    return new Category(
      params.id,
      params.slug,
      params.parentId ?? null,
      params.sortOrder ?? 0,
      null,
      now,
      now,
    );
  }

  static reconstitute(params: {
    id: string;
    slug: string;
    parentId: string | null;
    sortOrder: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Category {
    return new Category(
      UUIDv7.fromString(params.id),
      params.slug,
      params.parentId,
      params.sortOrder,
      params.deletedAt,
      params.createdAt,
      params.updatedAt,
    );
  }

  get slug(): string { return this._slug; }
  get parentId(): string | null { return this._parentId; }
  get sortOrder(): number { return this._sortOrder; }
  get deletedAt(): Date | null { return this._deletedAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get isDeleted(): boolean { return this._deletedAt !== null; }

  update(params: { parentId?: string | null; sortOrder?: number }): void {
    if (params.parentId !== undefined) this._parentId = params.parentId;
    if (params.sortOrder !== undefined) this._sortOrder = params.sortOrder;
    this._updatedAt = new Date();
  }

  softDelete(): void {
    this._deletedAt = new Date();
    this._updatedAt = new Date();
  }
}
