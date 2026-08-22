import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';

vi.mock('../core/api/client', () => ({
  apiClient: {
    get: vi.fn().mockImplementation((url: string) => {
      if (url === '/health') {
        return Promise.resolve({
          data: {
            status: 'ok',
            info: {
              database: { status: 'up' },
              redis: { status: 'up' },
            },
          },
        });
      }
      if (url.includes('/admin/analytics/overview')) {
        return Promise.resolve({
          data: {
            data: {
              dau: 450,
              wau: 1800,
              mau: 6500,
              newUsersToday: 42,
              totalContent: 128,
              topContent: [
                { id: '1', title: 'الأصول الثلاثة — الدرس الأول', type: 'AUDIO', viewCount: 1540 },
                { id: '2', title: 'كتاب التوحيد للإمام المجدد', type: 'PDF', viewCount: 980 },
              ],
              authMethodBreakdown: {
                email: 100,
                phone: 0,
                google: 0,
                apple: 0,
                facebook: 0,
              },
            },
          },
        });
      }
      return Promise.resolve({ data: {} });
    }),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider direction="rtl">{children}</ConfigProvider>
    </QueryClientProvider>
  );
};

describe('DashboardScreen Component Tests', () => {
  it('renders dashboard title and metric cards correctly', async () => {
    render(<DashboardScreen />, { wrapper: createWrapper() });

    expect(await screen.findByText('لوحة المؤشرات والتحليلات العامة')).toBeInTheDocument();
    expect(await screen.findByText('المستخدمين النشطين يومياً (DAU)')).toBeInTheDocument();
    expect(await screen.findByText('النشطين أسبوعياً (WAU)')).toBeInTheDocument();
    expect(await screen.findByText('إجمالي المحتوى المنشور')).toBeInTheDocument();
  });

  it('renders infrastructure health indicators', async () => {
    render(<DashboardScreen />, { wrapper: createWrapper() });

    expect(await screen.findByText('حالة النظام والبنية التحتية')).toBeInTheDocument();
    expect(await screen.findByText('PostgreSQL 16 (UUIDv7)')).toBeInTheDocument();
    expect(await screen.findByText('Redis 7 (Sessions & Cache)')).toBeInTheDocument();
  });
});
