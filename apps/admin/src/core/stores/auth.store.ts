import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Role, UserProfile } from '../types/auth.types';

const STORAGE_KEY = 'majlis_admin_auth';

/**
 * One-time purge of the legacy localStorage slice.
 *
 * Tokens are no longer written to localStorage. Any pre-existing slice is
 * discarded rather than migrated, because it may hold a forged SuperAdmin
 * session minted by the removed offline-login fallback.
 */
if (typeof window !== 'undefined') {
  window.localStorage?.removeItem(STORAGE_KEY);
}

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  role: Role | null;

  // Actions
  setAuth: (user: UserProfile, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: UserProfile) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    immer((set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      role: null,

      setAuth: (user, accessToken, refreshToken) =>
        set((state) => {
          state.user = user;
          state.accessToken = accessToken;
          state.refreshToken = refreshToken;
          state.isAuthenticated = true;
          state.role = user.role;
        }),

      setTokens: (accessToken, refreshToken) =>
        set((state) => {
          state.accessToken = accessToken;
          state.refreshToken = refreshToken;
        }),

      setUser: (user) =>
        set((state) => {
          state.user = user;
          state.role = user.role;
        }),

      logout: () =>
        set((state) => {
          state.user = null;
          state.accessToken = null;
          state.refreshToken = null;
          state.isAuthenticated = false;
          state.role = null;
        }),
    })),
    {
      name: STORAGE_KEY,
      // Interim transport until HttpOnly cookies land: sessionStorage keeps
      // tokens off disk and scopes them to the tab, instead of localStorage.
      storage: createJSONStorage(() => sessionStorage),
      // Tokens and the authenticated flag persist together — never split them,
      // or a reload could restore `isAuthenticated: true` with no real token.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        role: state.role,
      }),
    },
  ),
);
