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
              totalContent: 128,
              totalUsers: 6500,
              totalViews: 48920,
              activeDrafts: 7,
              topContent: [
                { id: '1', title: 'الأصول الثلاثة — الدرس الأول', type: 'AUDIO', viewCount: 1540 },
                { id: '2', title: 'كتاب التوحيد للإمام المجدد', type: 'PDF', viewCount: 980 },
              ],
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

    expect(
      await screen.findByText('لوحة المؤشرات والتحليلات العامة — مجالس العلم'),
    ).toBeInTheDocument();
    expect(await screen.findByText('إجمالي المواد المنشورة')).toBeInTheDocument();
    expect(await screen.findByText('المستمعون والزوار')).toBeInTheDocument();
    expect(await screen.findByText('المستخدمون المسجلون')).toBeInTheDocument();
    expect(await screen.findByText('المسودات قيد المراجعة')).toBeInTheDocument();
  });

  it('renders the top-content table with the values returned by the API', async () => {
    render(<DashboardScreen />, { wrapper: createWrapper() });

    expect(await screen.findByText('المواد الأكثر قراءة واستماعاً')).toBeInTheDocument();
    expect(await screen.findByText('الأصول الثلاثة — الدرس الأول')).toBeInTheDocument();
    expect(await screen.findByText('كتاب التوحيد للإمام المجدد')).toBeInTheDocument();

    // Values come from the mocked response, not from the component's hardcoded defaults
    expect(await screen.findByText('128')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
  });

  it('renders the sheikh profile card', async () => {
    render(<DashboardScreen />, { wrapper: createWrapper() });

    expect(await screen.findByText('عن صاحب المجلس')).toBeInTheDocument();
    expect(
      await screen.findByText('فضيلة الشيخ علي الويسي حفظه الله'),
    ).toBeInTheDocument();
  });
});
