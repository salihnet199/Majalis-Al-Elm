export type ContentType = 'AUDIO' | 'PDF' | 'TEXT' | 'IMAGE';
export type ContentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

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
