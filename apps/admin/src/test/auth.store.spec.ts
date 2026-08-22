import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../core/stores/auth.store';
import { UserProfile } from '../core/types/auth.types';

describe('AuthStore Unit Tests', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('starts with unauthenticated state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.role).toBeNull();
  });

  it('sets authentication state correctly on setAuth', () => {
    const mockUser: UserProfile = {
      id: '01920abc-1234-7000-8000-000000000001',
      fullName: 'مدير النظام',
      email: 'admin@majalis-elm.app',
      role: 'Admin',
    };

    useAuthStore.getState().setAuth(mockUser, 'access_token_123', 'refresh_token_456');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.fullName).toBe('مدير النظام');
    expect(state.role).toBe('Admin');
    expect(state.accessToken).toBe('access_token_123');
    expect(state.refreshToken).toBe('refresh_token_456');
  });

  it('updates token pair on setTokens (silent refresh)', () => {
    useAuthStore.getState().setTokens('new_access_token', 'new_refresh_token');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new_access_token');
    expect(state.refreshToken).toBe('new_refresh_token');
  });

  it('clears all credentials on logout', () => {
    const mockUser: UserProfile = {
      id: '01920abc-1234-7000-8000-000000000002',
      fullName: 'سوبر أدمن',
      email: 'superadmin@majalis-elm.app',
      role: 'SuperAdmin',
    };

    useAuthStore.getState().setAuth(mockUser, 'token_a', 'token_b');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.role).toBeNull();
    expect(state.accessToken).toBeNull();
  });
});
