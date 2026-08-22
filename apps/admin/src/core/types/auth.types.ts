export interface ApiResponseEnvelope<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    nextCursor?: string | null;
    prevCursor?: string | null;
  };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown[];
    trace_id?: string;
  };
}

export type Role = 'SuperAdmin' | 'Admin' | 'Editor' | 'Moderator' | 'User';

// Security Allowlist: SuperAdmin CANNOT be assigned through API
export const ASSIGNABLE_ROLES: Role[] = ['Admin', 'Editor', 'Moderator', 'User'];

export interface UserProfile {
  id: string;
  fullName: string;
  email: string | null;
  phoneE164?: string | null;
  role: Role;
  avatarUrl?: string | null;
  bio?: string | null;
  locale?: string;
  theme?: string;
  audioSpeed?: number;
  isSuspended?: boolean;
  suspendedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface LoginResponse {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
