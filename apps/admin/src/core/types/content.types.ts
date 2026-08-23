export type ContentType = 'AUDIO' | 'PDF' | 'TEXT' | 'IMAGE';
/**
 * REVIEW is part of the server's state machine (DRAFT → REVIEW → PUBLISHED →
 * ARCHIVED). It was missing from this union, so an item awaiting review fell
 * through every `status === ...` chain in the UI and was labelled "مؤرشف".
 */
export type ContentStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';

/**
 * One row of `GET /admin/content` — the admin projection, not the public one.
 *
 * `title` is nullable on purpose: an item can exist with no title translation in
 * the requested locale, and the list says so rather than showing the slug in the
 * title column.
 */
export interface AdminContentRow {
  id: string;
  slug: string;
  type: ContentType;
  status: ContentStatus;
  primaryLocale: string;
  title: string | null;
  categoryId: string | null;
  authorId: string | null;
  mediaAssetId: string | null;
  viewCount: number;
  isFeatured: boolean;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ContentTranslation {
  id?: string;
  language: string;
  title: string;
  description?: string;
  bodyHtml?: string;
  metadata?: Record<string, unknown>;
}

export interface ContentItem {
  id: string;
  slug: string;
  type: ContentType;
  status: ContentStatus;
  primaryLanguage: string;
  title: string;
  authorName?: string;
  viewCount: number;
  downloadCount: number;
  durationSeconds?: number;
  fileSizeBytes?: number;
  pageCount?: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
  categoryId?: string;
  categoryName?: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  translations?: ContentTranslation[];
  tags?: string[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  itemCount: number;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  itemCount: number;
}

export interface AnalyticsOverview {
  dau: number;
  wau: number;
  mau: number;
  newUsersToday: number;
  totalContent: number;
  topContent: Array<{
    id: string;
    title: string;
    type: ContentType;
    viewCount: number;
  }>;
  authMethodBreakdown: {
    email: number;
    phone: number;
    google: number;
    apple: number;
    facebook: number;
  };
}
