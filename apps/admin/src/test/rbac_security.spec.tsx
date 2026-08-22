import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { useAuthStore } from '../core/stores/auth.store';
import { SuperAdminOnly } from '../core/guards/RbacGuard';
import { ASSIGNABLE_ROLES } from '../core/types/auth.types';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider direction="rtl">{children}</ConfigProvider>
    </QueryClientProvider>
  );
};

describe('RBAC Security & Role Assignment Restrictions', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it('CRITICAL SECURITY: ASSIGNABLE_ROLES allowlist strictly contains 4 roles and excludes SuperAdmin', () => {
    // SuperAdmin must NEVER be in the assignable roles list via API
    expect(ASSIGNABLE_ROLES).toEqual(['Admin', 'Editor', 'Moderator', 'User']);
    expect(ASSIGNABLE_ROLES).not.toContain('SuperAdmin');
    expect(ASSIGNABLE_ROLES.length).toBe(4);
  });

  it('CRITICAL SECURITY: SuperAdminOnly renders content when user is SuperAdmin', () => {
    useAuthStore.getState().setAuth(
      {
        id: 'super-1',
        fullName: 'المدير الأعلى',
        email: 'super@majlis-alim.app',
        role: 'SuperAdmin',
      },
      'token_super',
      'refresh_super',
    );

    render(
      <SuperAdminOnly>
        <button data-testid="change-role-btn">تغيير الدور</button>
      </SuperAdminOnly>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('change-role-btn')).toBeInTheDocument();
    expect(screen.getByText('تغيير الدور')).toBeInTheDocument();
  });

  it('CRITICAL SECURITY: SuperAdminOnly DOES NOT render content when user is normal Admin', () => {
    useAuthStore.getState().setAuth(
      {
        id: 'admin-1',
        fullName: 'مسؤول عادي',
        email: 'admin@majlis-alim.app',
        role: 'Admin',
      },
      'token_admin',
      'refresh_admin',
    );

    render(
      <SuperAdminOnly>
        <button data-testid="change-role-btn">تغيير الدور</button>
      </SuperAdminOnly>,
      { wrapper: createWrapper() },
    );

    // Button MUST NOT exist in DOM for normal Admin
    expect(screen.queryByTestId('change-role-btn')).toBeNull();
    expect(screen.queryByText('تغيير الدور')).toBeNull();
  });

  it('CRITICAL SECURITY: SuperAdminOnly DOES NOT render content when user is Editor or Moderator', () => {
    useAuthStore.getState().setAuth(
      {
        id: 'editor-1',
        fullName: 'محرر محتوى',
        email: 'editor@majlis-alim.app',
        role: 'Editor',
      },
      'token_editor',
      'refresh_editor',
    );

    render(
      <SuperAdminOnly fallback={<span data-testid="fallback">لا توجد صلاحية</span>}>
        <button data-testid="change-role-btn">تغيير الدور</button>
      </SuperAdminOnly>,
      { wrapper: createWrapper() },
    );

    expect(screen.queryByTestId('change-role-btn')).toBeNull();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });
});
