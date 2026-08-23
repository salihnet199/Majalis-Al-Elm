import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, message } from 'antd';

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
  // antd's static `message` lives in its own container outside the tree that RTL
  // unmounts, so toasts survive into the next test. Since half of these
  // assertions are "no success message is present", a leaked toast is a false
  // pass or a false failure depending on the order — clear it explicitly.
  message.destroy();
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

/**
 * The publishing claim.
 *
 * `POST /admin/content` creates a DRAFT — always; the form's old status field was
 * whitelisted away by the server and never reached the database. The toast said
 * "تم إضافة ونشر المحتوى بنجاح" regardless. These tests pin the replacement: the
 * announced state is the state the server reported, and a failed transition is
 * reported as a failed transition even though the save itself succeeded.
 */
describe('POLICY-SEC-001: the content editor announces only the status the server reported', () => {
  const CATEGORY = { id: 'cat-1', slug: 'duroos', name: 'الدروس العلمية', contentCount: 3 };

  const mockReads = () => {
    (apiClient.get as Mock).mockImplementation(async (url: string) => {
      if (url === '/content/categories') return { data: { data: [CATEGORY] } };
      if (url === '/admin/authors') return { data: { data: [] } };
      throw new Error(`unexpected GET ${url}`);
    });
  };

  /** Opens the antd Select inside the form item carrying `label`. */
  const openSelect = (label: string) => {
    const item = screen.getByText(label).closest('.ant-form-item') as HTMLElement;
    fireEvent.mouseDown(item.querySelector('.ant-select-selector') as HTMLElement);
  };

  const fillNewItem = async () => {
    // Waiting for the category name proves the list loaded and was preselected.
    expect(await findText(CATEGORY.name)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('مثال: شرح كتاب التوحيد — الدرس الأول'), {
      target: { value: 'شرح كتاب التوحيد — الدرس الأول' },
    });
    fireEvent.change(screen.getByPlaceholderText('kitab-tawheed-01'), {
      target: { value: 'kitab-tawheed-01' },
    });
  };

  const save = () => fireEvent.click(screen.getByRole('button', { name: 'حفظ المادة' }));

  it('does not claim the item was saved when the create request fails', async () => {
    mockReads();
    (apiClient.post as Mock).mockRejectedValue(serverError);

    render(<ContentModal open initialData={null} onClose={() => undefined} />, {
      wrapper: createWrapper(),
    });

    await fillNewItem();
    save();

    expect(await findText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/تم إضافة ونشر المحتوى بنجاح/)).toBeNull();
    expect(screen.queryByText(/تم إنشاء المادة/)).toBeNull();
  });

  it('reports "مسودة" — not publication — for an item the server created as a draft', async () => {
    mockReads();
    (apiClient.post as Mock).mockResolvedValue({
      data: { data: { id: 'c-1', slug: 'kitab-tawheed-01', type: 'AUDIO', status: 'DRAFT' } },
    });

    render(<ContentModal open initialData={null} onClose={() => undefined} />, {
      wrapper: createWrapper(),
    });

    await fillNewItem();
    save();

    expect(await findText('تم إنشاء المادة — الحالة الحالية: مسودة.')).toBeInTheDocument();
    expect(screen.queryByText(/ونشر المحتوى بنجاح/)).toBeNull();

    // The payload is the DTO the endpoint accepts. `mediaUrl`/`authorName`/`status`
    // were silently stripped by the global ValidationPipe (whitelist: true), which
    // is why the old form could report 201 and change nothing.
    const body = (apiClient.post as Mock).mock.calls[0][1];
    expect(body).toMatchObject({
      slug: 'kitab-tawheed-01',
      type: 'AUDIO',
      primaryLocale: 'ar',
      categoryId: 'cat-1',
      translations: [{ locale: 'ar', title: 'شرح كتاب التوحيد — الدرس الأول' }],
    });
    expect(body).not.toHaveProperty('mediaUrl');
    expect(body).not.toHaveProperty('authorName');
    expect(body).not.toHaveProperty('status');
    // Exactly one call: nothing was transitioned, because no transition was asked for.
    expect((apiClient.post as Mock).mock.calls).toHaveLength(1);
  });

  it('does not claim publication when the review transition fails after a successful create', async () => {
    mockReads();
    (apiClient.post as Mock).mockImplementation(async (url: string) => {
      if (url === '/admin/content') {
        return { data: { data: { id: 'c-1', slug: 'kitab-tawheed-01', type: 'AUDIO', status: 'DRAFT' } } };
      }
      throw Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: { error: { code: 'FORBIDDEN', message: 'Editor cannot publish' } } },
      });
    });

    render(<ContentModal open initialData={null} onClose={() => undefined} />, {
      wrapper: createWrapper(),
    });

    await fillNewItem();

    openSelect('الإجراء بعد الحفظ');
    const options = await screen.findAllByText('نشرها للعامة (مراجعة ثم نشر)');
    fireEvent.click(options[options.length - 1]);

    save();

    // Both facts, in one message: the item exists, and it is not published.
    const warning = await findText(/تغيير الحالة لم يكتمل/);
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toContain('الحالة الحالية: مسودة');
    expect(screen.queryByText(/الحالة الحالية: منشور/)).toBeNull();
    // The chain stopped at its first failing step rather than pressing on to publish.
    const posted = (apiClient.post as Mock).mock.calls.map((c) => c[0]);
    expect(posted).toEqual(['/admin/content', '/admin/content/c-1/submit-review']);
  });

  it('treats a create response without an id as a failure, not a save', async () => {
    mockReads();
    (apiClient.post as Mock).mockResolvedValue({ data: { data: { slug: 'kitab-tawheed-01' } } });

    render(<ContentModal open initialData={null} onClose={() => undefined} />, {
      wrapper: createWrapper(),
    });

    await fillNewItem();
    save();

    expect(await findText('تم قبول الطلب لكن الخادم لم يُعِد معرّف المادة المنشأة.')).toBeInTheDocument();
    expect(screen.queryByText(/تم إنشاء المادة/)).toBeNull();
  });

  it('disables saving when the item’s real state could not be read, instead of writing guesses', async () => {
    (apiClient.get as Mock).mockImplementation(async (url: string) => {
      if (url === '/content/categories') return { data: { data: [CATEGORY] } };
      if (url === '/admin/authors') return { data: { data: [] } };
      throw serverError; // GET /admin/content/c-1
    });

    const row = {
      id: 'c-1',
      slug: 'kitab-tawheed-01',
      type: 'AUDIO',
      status: 'PUBLISHED',
      primaryLocale: 'ar',
      title: 'شرح كتاب التوحيد',
      categoryId: null,
      authorId: null,
      mediaAssetId: null,
      viewCount: 0,
      isFeatured: false,
      publishedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const;

    render(
      <ContentModal open initialData={row as never} onClose={() => undefined} />,
      { wrapper: createWrapper() },
    );

    expect(await findText('تعذّر قراءة بيانات المادة من الخادم')).toBeInTheDocument();

    const ok = screen.getByRole('button', { name: 'حفظ التعديلات' });
    expect(ok).toBeDisabled();

    fireEvent.click(ok);
    expect(apiClient.patch).not.toHaveBeenCalled();
    // The form itself is not rendered, so there are no half-known values on screen
    // that could be mistaken for the item's real category, author or attached file.
    expect(screen.queryByPlaceholderText('مثال: شرح كتاب التوحيد — الدرس الأول')).toBeNull();
  });
});

