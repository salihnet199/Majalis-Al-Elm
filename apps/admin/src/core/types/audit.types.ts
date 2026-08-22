export interface AuditLogItem {
  id: string;
  actor: {
    id: string;
    name: string;
    email?: string;
    role: string;
  };
  action: string;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  target: 'ALL' | 'USERS' | 'ADMINS';
  sentBy: {
    id: string;
    name: string;
  };
  recipientCount?: number;
  createdAt: string;
}
