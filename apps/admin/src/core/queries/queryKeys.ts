export const queryKeys = {
  analytics: {
    all: ['analytics'] as const,
    overview: () => [...queryKeys.analytics.all, 'overview'] as const,
    content: (filters?: Record<string, unknown>) => [...queryKeys.analytics.all, 'content', filters] as const,
  },
  content: {
    all: ['content'] as const,
    lists: () => [...queryKeys.content.all, 'list'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.content.lists(), params] as const,
    details: () => [...queryKeys.content.all, 'detail'] as const,
    detail: (idOrSlug: string) => [...queryKeys.content.details(), idOrSlug] as const,
    /**
     * The admin-shaped read of one item (GET /admin/content/:id). Kept distinct
     * from detail() because that one is the public, PUBLISHED-only projection —
     * caching them under one key would let a reader's row answer an editor's read.
     */
    adminDetail: (id: string) => [...queryKeys.content.details(), 'admin', id] as const,
    categories: () => [...queryKeys.content.all, 'categories'] as const,
    authors: () => [...queryKeys.content.all, 'authors'] as const,
    tags: () => [...queryKeys.content.all, 'tags'] as const,
  },
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.users.lists(), params] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.users.details(), id] as const,
  },
  auditLogs: {
    all: ['auditLogs'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.auditLogs.all, 'list', params] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.announcements.all, 'list', params] as const,
  },
  systemHealth: {
    all: ['systemHealth'] as const,
  },
};
