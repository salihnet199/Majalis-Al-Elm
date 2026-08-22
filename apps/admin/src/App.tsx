import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import arEG from 'antd/locale/ar_EG';
import enUS from 'antd/locale/en_US';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUiStore } from './core/stores/ui.store';
import { getThemeConfig } from './core/theme/theme.config';
import { AuthGuard } from './core/guards/AuthGuard';
import { AdminLayout } from './layouts/AdminLayout';
import { LoginScreen } from './features/auth/LoginScreen';
import { DashboardScreen } from './features/dashboard/DashboardScreen';
import { ContentListScreen } from './features/content/ContentListScreen';
import { CategoriesScreen } from './features/content/CategoriesScreen';
import { UserListScreen } from './features/users/UserListScreen';
import { AuditLogsScreen } from './features/audit/AuditLogsScreen';
import { AnnouncementsScreen } from './features/announcements/AnnouncementsScreen';
import { CmsSettingsScreen } from './features/cms/CmsSettingsScreen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

export const App: React.FC = () => {
  const { theme, direction, language } = useUiStore();
  const antdTheme = getThemeConfig(theme);
  const locale = language === 'ar' ? arEG : enUS;

  React.useEffect(() => {
    document.documentElement.className = theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('dir', direction);
  }, [theme, direction]);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={antdTheme}
        direction={direction}
        locale={locale}
      >
        <BrowserRouter>
          <Routes>
            {/* Public Route */}
            <Route path="/login" element={<LoginScreen />} />

            {/* Protected Admin Routes */}
            <Route
              path="/"
              element={
                <AuthGuard>
                  <AdminLayout />
                </AuthGuard>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardScreen />} />
              <Route path="content" element={<ContentListScreen />} />
              <Route path="categories" element={<CategoriesScreen />} />
              <Route path="users" element={<UserListScreen />} />
              <Route path="cms" element={<CmsSettingsScreen />} />
              <Route path="audit-logs" element={<AuditLogsScreen />} />
              <Route path="announcements" element={<AnnouncementsScreen />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
};
