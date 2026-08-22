import React from 'react';
import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';
import { Role } from '../types/auth.types';

interface RbacGuardProps {
  allowedRoles: Role[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const RbacGuard: React.FC<RbacGuardProps> = ({ allowedRoles, children, fallback }) => {
  const { role } = useAuthStore();
  const navigate = useNavigate();

  if (!role || !allowedRoles.includes(role)) {
    if (fallback) return <>{fallback}</>;

    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <Result
          status="403"
          title="غير مصرح بالدخول"
          subTitle="عفواً، لا تمتلك الصلاحيات الإدارية الكافية للوصول إلى هذه الصفحة أو تنفيذ هذا الإجراء."
          extra={
            <Button type="primary" onClick={() => navigate('/dashboard')}>
              العودة للرئيسية
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
};

/**
 * SuperAdminOnly — Strict security component wrapper:
 * Renders children ONLY if the logged-in user is 'SuperAdmin'.
 * If user is normal 'Admin' or any other role, renders NOTHING (or optional fallback).
 */
export const SuperAdminOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback = null }) => {
  const { role } = useAuthStore();
  if (role !== 'SuperAdmin') {
    return <>{fallback}</>;
  }
  return <>{children}</>;
};
