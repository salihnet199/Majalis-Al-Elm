import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';

/**
 * POLICY-SEC-001 regression suite — see docs/governance/TECHNICAL_DEBT.md.
 *
 * Every screen below used to answer a failed request with invented data or an
 * invented success toast. These tests fail the moment that pattern comes back:
 * each one asserts that the Arabic failure text is visible AND that the specific
 * strings/figures the old fallbacks produced are absent.
 */

vi.mock('../core/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '../core/api/client';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { AnnouncementsScreen } from '../features/announcements/AnnouncementsScreen';
import { CategoriesScreen } from '../features/content/CategoriesScreen';
import { ContentModal } from '../features/content/ContentModal';

const networkError = Object.assign(new Error('Network Error'), {
  code: 'ERR_NETWORK',
  request: {},
  isAxiosError: true,
});

const serverError = Object.assign(new Error('Request failed with status code 500'), {
  isAxiosError: true,
  response: { status: 500, data: {} },
});

const NETWORK_MESSAGE = 'تعذر الاتصال بالخادم، يرجى التحقق من الشبكة ومن أن الخدمة تعمل';
const SERVER_MESSAGE = 'خطأ في الخادم، يرجى المحاولة لاحقاً أو مراجعة سجلات النظام';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // The screens set `retry: 1` deliberately; keep it, but don't wait for the
      // exponential backoff in tests.
      queries: { retryDelay: 0, gcTime: 0 },
      mutations: { retryDelay: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider direction="rtl">{children}</ConfigProvider>
    </QueryClientProvider>
  );
};

const findText = (text: string | RegExp) => screen.findByText(text, undefined, { timeout: 5000 });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POLICY-SEC-001: dashboard never fabricates statistics or health', () => {
  beforeEach(() => {
    (apiClient.get as Mock).mockRejectedValue(networkError);
  });

  it('reports the real failure instead of the invented 86 / 1,420 / 48,920 figures', async () => {
    render(<DashboardScreen />, { wrapper: createWrapper() });

    expect(await findText('تعذر تحميل إحصائيات المنصة من الخادم')).toBeInTheDocument();

    // The metric cards show '—', never the old hardcoded defaults.
    expect(screen.queryByText('86')).toBeNull();
    expect(screen.queryByText('1,420')).toBeNull();
    expect(screen.queryByText('48,920')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // ...and none of the four invented content rows.
    expect(screen.queryByText('شرح كتاب العقيدة الطحاوية — الدرس 14')).toBeNull();
    expect(screen.queryByText('منزلة الصبر واليقين في القرآن الكريم')).toBeNull();
  });

  it('shows the service as unreachable when /health itself fails', async () => {
    render(<DashboardScreen />, { wrapper: createWrapper() });

    // The catch used to return { status: 'ok', database: 'up' } here — the single
    // most misleading fabrication in the admin app.
    expect(await findText('تعذر الوصول إلى الخادم — الحالة الحقيقية غير سليمة')).toBeInTheDocument();
    expect(screen.queryByText('الخدمة متصلة وتعمل')).toBeNull();
  });
});

describe('POLICY-SEC-001: announcements never fabricate broadcasts', () => {
  it('renders the Arabic failure banner instead of two invented announcements', async () => {
    (apiClient.get as Mock).mockRejectedValue(networkError);

    render(<AnnouncementsScreen />, { wrapper: createWrapper() });

    expect(await findText('تعذر تحميل سجل الإعلانات من الخادم')).toBeInTheDocument();
    expect(screen.queryByText('بدء التسجيل في دورة شرح العقيدة الطحاوية')).toBeNull();
    expect(screen.queryByText('تحديث تطبيق مجالس العلم للإصدار الجديد')).toBeNull();
  });

  it('does not claim a broadcast was sent when the request fails', async () => {
    (apiClient.get as Mock).mockResolvedValue({ data: { data: [] } });
    (apiClient.post as Mock).mockRejectedValue(serverError);

    render(<AnnouncementsScreen />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByPlaceholderText('مثال: موعد البث المباشر لدرس اليوم'), {
      target: { value: 'إعلان اختباري' },
    });
    fireEvent.change(screen.getByPlaceholderText('يسر إدارة منصة مجالس العلم الإعلان عن...'), {
      target: { value: 'نص الإعلان الاختباري' },
    });
    fireEvent.click(screen.getByRole('button', { name: /إرسال وبث الإشعار الآن/ }));

    expect(await findText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('تم تسجيل الإعلان بنجاح.')).toBeNull();
    // The composed text survives so the admin can retry.
    expect(screen.getByDisplayValue('إعلان اختباري')).toBeInTheDocument();
  });
});

describe('POLICY-SEC-001: categories never fabricate sections or content counts', () => {
  it('renders the Arabic failure banner instead of five invented categories', async () => {
    (apiClient.get as Mock).mockRejectedValue(networkError);

    render(<CategoriesScreen />, { wrapper: createWrapper() });

    expect(await findText('تعذر تحميل الأقسام من الخادم')).toBeInTheDocument();
    expect(screen.queryByText('الفتاوى الشرعية')).toBeNull();
    expect(screen.queryByText('الدروس العلمية والخطب')).toBeNull();
    expect(screen.queryByText('السيرة النبوية والتاريخ')).toBeNull();
  });

  it('does not claim a category was created when the request fails', async () => {
    (apiClient.get as Mock).mockResolvedValue({ data: { data: [] } });
    (apiClient.post as Mock).mockRejectedValue(serverError);

    render(<CategoriesScreen />, { wrapper: createWrapper() });

    const input = screen.getByPlaceholderText(/اكتب اسم القسم الجديد/);
    fireEvent.change(input, { target: { value: 'قسم اختباري' } });
    fireEvent.click(screen.getByRole('button', { name: /إضافة القسم/ }));

    expect(await findText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('تم تسجيل وإضافة القسم بنجاح.')).toBeNull();
    // The typed name is preserved — the old handler cleared it while reporting success.
    expect(screen.getByDisplayValue('قسم اختباري')).toBeInTheDocument();
  });
});

describe('POLICY-SEC-001: the content editor never offers invented categories', () => {
  it('warns that categories could not be loaded rather than listing five fake ones', async () => {
    (apiClient.get as Mock).mockRejectedValue(networkError);

    render(<ContentModal open initialData={null} onClose={() => undefined} />, {
      wrapper: createWrapper(),
    });

    expect(await findText('تعذر تحميل قائمة الأقسام من الخادم')).toBeInTheDocument();
    // The Alert description appends an explanatory clause to the message inside
    // the same element, so match on containment rather than the exact node text.
    expect(screen.getAllByText(new RegExp(NETWORK_MESSAGE)).length).toBeGreaterThan(0);
    expect(screen.queryByText('المقالات والبحوث')).toBeNull();
    expect(screen.queryByText('الصوتيات والدروس المسجلة')).toBeNull();
  });
});
