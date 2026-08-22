import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export type ThemeMode = 'dark' | 'light';
export type Language = 'ar' | 'en';

interface UiState {
  theme: ThemeMode;
  language: Language;
  direction: 'rtl' | 'ltr';
  sidebarCollapsed: boolean;

  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setLanguage: (lang: Language) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    immer((set) => ({
      theme: 'dark',
      language: 'ar',
      direction: 'rtl',
      sidebarCollapsed: false,

      setTheme: (theme) =>
        set((state) => {
          state.theme = theme;
        }),

      toggleTheme: () =>
        set((state) => {
          state.theme = state.theme === 'dark' ? 'light' : 'dark';
        }),

      setLanguage: (lang) =>
        set((state) => {
          state.language = lang;
          state.direction = lang === 'ar' ? 'rtl' : 'ltr';
        }),

      toggleSidebar: () =>
        set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        }),

      setSidebarCollapsed: (collapsed) =>
        set((state) => {
          state.sidebarCollapsed = collapsed;
        }),
    })),
    {
      name: 'majlis_admin_ui',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        direction: state.direction,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
