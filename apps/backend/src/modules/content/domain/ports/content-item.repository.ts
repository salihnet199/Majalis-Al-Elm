import { ContentItem, ContentType } from '../content-item.entity';

export interface ContentItemFilter {
  type?: ContentType;
  categorySlug?: string;
  locale?: string;
  limit: number;
  cursor?: string | null;
}

export interface ContentItemPage {
  items: ContentItem[];
  nextCursor: string | null;
  prevCursor: string | null;
}

/**
 * IContentItemRepository — Domain Port (P-06)
 * TypeORM implementation lives in infrastructure/persistence/
 */
export interface IContentItemRepository {
  findPublished(filter: ContentItemFilter): Promise<ContentItemPage>;
  findBySlug(slug: string): Promise<ContentItem | null>;
  findById(id: string): Promise<ContentItem | null>;
  save(item: ContentItem): Promise<ContentItem>;
  update(item: ContentItem): Promise<ContentItem>;
  softDelete(item: ContentItem): Promise<void>;
  incrementViewCount(id: string): Promise<void>;
}

export const CONTENT_ITEM_REPOSITORY = Symbol('IContentItemRepository');
