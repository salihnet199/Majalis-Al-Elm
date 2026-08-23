import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Select, message, Alert, Spin, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { toArabicErrorMessage } from '../../core/api/errorMessage';
import { queryKeys } from '../../core/queries/queryKeys';
import { AdminContentRow } from '../../core/types/content.types';
import { MediaUploadField } from './MediaUploadField';

const { Option } = Select;
const { TextArea } = Input;
const { Text } = Typography;

/**
 * The content editor form.
 *
 * Two things in here used to be untrue, and both are fixed by construction rather
 * than by wording:
 *
 *  1. The media field was a text input for a URL, and the payload it produced
 *     (`mediaUrl`) is not a field any endpoint accepts — the global ValidationPipe
 *     runs with `whitelist: true`, so the server dropped it silently and answered
 *     201. The editor saw success and no file. It now uses <MediaUploadField>,
 *     whose value is a `mediaAssetId` the server has verified against the bucket
 *     (ADR-013 Stage A).
 *
 *  2. `POST /admin/content` always creates a DRAFT — the status field in this form
 *     was never sent anywhere — yet the toast said "تم إضافة ونشر المحتوى بنجاح".
 *     Publishing is a real state machine (DRAFT → REVIEW → PUBLISHED), so this
 *     form now performs those transitions and reports the status the server
 *     actually returned, including the case where the item was created but the
 *     publish leg failed.
 *
 * In edit mode the initial values come from `GET /admin/content/:id`, not from the
 * public catalogue row that opened the modal: that row has no categoryId, no
 * authorId and no mediaAssetId, so a save built on it would blank all three.
 */

type PostSaveAction = 'NONE' | 'SUBMIT_REVIEW' | 'PUBLISH' | 'ARCHIVE';

interface AdminContentDetail {
  id: string;
  slug: string;
  type: string;
  status: string;
  primaryLocale: string;
  authorId: string | null;
  categoryId: string | null;
  mediaAssetId: string | null;
  sortOrder: number;
  isFeatured: boolean;
  translations: Array<{
    locale: string;
    title: string | null;
    description: string | null;
    body: string | null;
  }>;
}

interface ContentModalProps {
  open: boolean;
  initialData: AdminContentRow | null;
  onClose: () => void;
}

const STATUS_LABEL_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  REVIEW: 'قيد المراجعة',
  PUBLISHED: 'منشور',
  ARCHIVED: 'مؤرشف',
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default',
  REVIEW: 'blue',
  PUBLISHED: 'green',
  ARCHIVED: 'orange',
};

/**
 * Only the transitions the domain entity actually allows are offered.
 * `submitForReview()` demands DRAFT, `publish()` demands REVIEW, `archive()`
 * demands PUBLISHED — anything else throws 422, so offering it would be inviting
 * the editor to press a button that cannot work.
 */
function allowedActions(status: string): Array<{ value: PostSaveAction; label: string }> {
  switch (status) {
    case 'DRAFT':
      return [
        { value: 'NONE', label: 'إبقاؤها مسودة' },
        { value: 'SUBMIT_REVIEW', label: 'إرسالها للمراجعة' },
        { value: 'PUBLISH', label: 'نشرها للعامة (مراجعة ثم نشر)' },
      ];
    case 'REVIEW':
      return [
        { value: 'NONE', label: 'إبقاؤها قيد المراجعة' },
        { value: 'PUBLISH', label: 'نشرها للعامة' },
      ];
    case 'PUBLISHED':
      return [
        { value: 'NONE', label: 'إبقاؤها منشورة' },
        { value: 'ARCHIVE', label: 'أرشفتها (إخفاؤها عن العامة)' },
      ];
    default:
      return [{ value: 'NONE', label: 'لا إجراء (المادة مؤرشفة)' }];
  }
}

interface SaveOutcome {
  id: string;
  finalStatus: string;
  requested: PostSaveAction;
  created: boolean;
  /** Set when the item was saved but a status transition failed. */
  transitionError?: string;
}

export const ContentModal: React.FC<ContentModalProps> = ({ open, initialData, onClose }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const isEditing = !!initialData;
  const [selectedType, setSelectedType] = useState<string>('AUDIO');

  // Dynamic Categories Query from ct_categories
  //
  // SECURITY: no fallback list. Fabricated categories here were the worst variant
  // of the pattern: the admin would pick an invented categoryId and publish real
  // material against a section that does not exist on the server.
  //
  // NOTE: this shares queryKeys.content.categories() with CategoriesScreen, so the
  // mapped shape must stay identical — including contentCount, which that screen
  // uses to decide whether deleting a category needs content reassignment.
  const { data: categories = [], isError: isCategoriesError, error: categoriesError } = useQuery({
    queryKey: queryKeys.content.categories(),
    queryFn: async () => {
      const res = await apiClient.get('/content/categories');
      const items = res.data?.data || res.data || [];
      return items.map((cat: any) => ({
        id: cat.id || cat.slug,
        slug: cat.slug,
        name: cat.name || cat.translations?.[0]?.name || cat.slug,
        contentCount: cat.contentCount || 0,
        createdAt: cat.createdAt,
      }));
    },
    staleTime: 30000,
    retry: 1,
  });

  // Authors, from ct_authors. `authorId` is a foreign key, so the old free-text
  // "اسم المؤلف" input could not have been saved under any spelling — it was
  // whitelisted away like mediaUrl.
  const { data: authors = [], isError: isAuthorsError, error: authorsError } = useQuery({
    queryKey: queryKeys.content.authors(),
    queryFn: async () => {
      const res = await apiClient.get('/admin/authors');
      const items = res.data?.data || [];
      return items.map((a: any) => ({ id: a.id, name: a.name || a.slug, slug: a.slug }));
    },
    enabled: open,
    staleTime: 30000,
    retry: 1,
  });

  // The true current state of the item being edited. Nothing is guessed from the
  // list row: if this read fails, the form refuses to save rather than write
  // half-known values over the real ones.
  const {
    data: detail,
    isLoading: isDetailLoading,
    isError: isDetailError,
    error: detailError,
  } = useQuery({
    queryKey: queryKeys.content.adminDetail(initialData?.id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get(`/admin/content/${initialData!.id}`);
      const data = res.data?.data;
      if (!data?.id) {
        throw new Error('لم يُعِد الخادم بيانات المادة');
      }
      return data as AdminContentDetail;
    },
    enabled: open && !!initialData?.id,
    // Always refetched on open: status and attached media change from other
    // screens, and a stale copy here becomes a stale write.
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  const currentStatus = detail?.status ?? 'DRAFT';

  /**
   * Which item's values are currently seeded into the form.
   *
   * The seeding effect must run exactly once per opened item. It used to depend on
   * `categories`, so the arrival of that list — tens or hundreds of milliseconds
   * after the modal opens — re-ran `resetFields()` and erased whatever the editor
   * had already typed, with no indication that it had happened.
   */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }

    const target = isEditing ? detail?.id : 'new';
    if (!target) return; // editing: wait for the real values
    if (seededFor.current === target) return;

    if (isEditing && detail) {
      const primary =
        detail.translations.find((t) => t.locale === detail.primaryLocale) ??
        detail.translations[0];
      setSelectedType(detail.type);
      form.setFieldsValue({
        title: primary?.title ?? '',
        description: primary?.description ?? '',
        body: primary?.body ?? '',
        slug: detail.slug,
        type: detail.type,
        primaryLocale: detail.primaryLocale,
        categoryId: detail.categoryId ?? undefined,
        authorId: detail.authorId ?? undefined,
        mediaAssetId: detail.mediaAssetId ?? undefined,
        postSaveAction: 'NONE',
      });
    } else {
      form.resetFields();
      setSelectedType('AUDIO');
      form.setFieldsValue({
        type: 'AUDIO',
        primaryLocale: 'ar',
        postSaveAction: 'NONE',
      });
    }

    seededFor.current = target;
  }, [open, isEditing, detail, form]);

  // Create mode: preselect a category once the list arrives — but never over a
  // choice already present, and without disturbing any other field.
  useEffect(() => {
    if (!open || isEditing) return;
    if (categories.length === 0) return;
    if (form.getFieldValue('categoryId')) return;
    form.setFieldsValue({ categoryId: categories[0].id });
  }, [open, isEditing, categories, form]);


  /**
   * Runs the requested status transitions and returns the status the server
   * reported. A step whose response omits `status` is treated as a failure: this
   * function's answer is displayed to the editor, so it may only contain states
   * the server confirmed.
   */
  const runTransitions = async (
    id: string,
    from: string,
    action: PostSaveAction,
  ): Promise<{ status: string; error?: string }> => {
    const chain: string[] = [];
    if (action === 'SUBMIT_REVIEW') chain.push('submit-review');
    if (action === 'PUBLISH') {
      if (from === 'DRAFT') chain.push('submit-review');
      chain.push('publish');
    }
    if (action === 'ARCHIVE') chain.push('archive');

    let status = from;
    for (const step of chain) {
      try {
        const res = await apiClient.post(`/admin/content/${id}/${step}`);
        const reported = res.data?.data?.status;
        if (!reported) {
          return {
            status,
            error: `نجح طلب «${step}» لكن الخادم لم يُعِد الحالة الجديدة، فلا يمكن تأكيد نتيجته.`,
          };
        }
        status = reported;
      } catch (error) {
        return { status, error: toArabicErrorMessage(error, `تعذّر تنفيذ الخطوة «${step}»`) };
      }
    }
    return { status };
  };

  const saveMutation = useMutation<SaveOutcome, unknown, any>({
    mutationFn: async (values: any) => {
      const locale: string = values.primaryLocale || 'ar';
      const translation: Record<string, string> = { locale, title: values.title };
      if (values.description) translation.description = values.description;
      if (values.body) translation.body = values.body;

      const action: PostSaveAction = values.postSaveAction || 'NONE';

      if (isEditing) {
        if (!detail) {
          // Unreachable through the UI (the OK button is disabled), kept because
          // a PATCH built on unknown values is the failure this guards.
          throw new Error('لم تُقرأ حالة المادة الحالية من الخادم، فلا يمكن الحفظ.');
        }

        await apiClient.patch(`/admin/content/${detail.id}`, {
          categoryId: values.categoryId,
          authorId: values.authorId ?? null,
          mediaAssetId: values.mediaAssetId ?? null,
          translations: [translation],
        });

        const { status, error } = await runTransitions(detail.id, detail.status, action);
        return { id: detail.id, finalStatus: status, requested: action, created: false, transitionError: error };
      }

      const res = await apiClient.post('/admin/content', {
        slug: values.slug,
        type: values.type,
        primaryLocale: locale,
        categoryId: values.categoryId,
        ...(values.authorId ? { authorId: values.authorId } : {}),
        ...(values.mediaAssetId ? { mediaAssetId: values.mediaAssetId } : {}),
        translations: [translation],
      });

      const created = res.data?.data;
      if (!created?.id || !created?.status) {
        // No id means nothing to transition and nothing to link to; reporting
        // success here is how a "saved" item that does not exist gets announced.
        throw new Error('تم قبول الطلب لكن الخادم لم يُعِد معرّف المادة المنشأة.');
      }

      const { status, error } = await runTransitions(created.id, created.status, action);
      return { id: created.id, finalStatus: status, requested: action, created: true, transitionError: error };
    },
    onSuccess: (outcome) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });

      const stateAr = STATUS_LABEL_AR[outcome.finalStatus] ?? outcome.finalStatus;
      const noun = outcome.created ? 'إنشاء المادة' : 'تحديث المادة';

      if (outcome.transitionError) {
        // The save happened; the transition did not. Both facts are reported,
        // because "تم النشر" over a draft is the exact defect this replaces.
        message.warning(
          `تم ${noun}، لكن تغيير الحالة لم يكتمل: ${outcome.transitionError} — الحالة الحالية: ${stateAr}.`,
          12,
        );
      } else {
        message.success(`تم ${noun} — الحالة الحالية: ${stateAr}.`);
      }
      onClose();
    },
    onError: (err) => {
      message.error(toArabicErrorMessage(err, 'فشلت عملية حفظ المحتوى'));
    },
  });

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      saveMutation.mutate(values);
    });
  };

  const blockedByDetail = isEditing && (isDetailLoading || isDetailError || !detail);
  const needsMedia = selectedType !== 'TEXT';

  return (
    <Modal
      open={open}
      title={
        <div className="font-ruqaa text-gold-400 font-bold text-xl">
          {isEditing ? 'تعديل المحتوى العلمي' : 'إضافة محتوى جديد لمجالس العلم'}
        </div>
      }
      okText={isEditing ? 'حفظ التعديلات' : 'حفظ المادة'}
      cancelText="إلغاء"
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saveMutation.isPending}
      okButtonProps={{
        className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo',
        disabled: blockedByDetail,
      }}
      width={720}
      destroyOnHidden
      cancelButtonProps={{ className: 'font-cairo' }}
    >
      {isEditing && isDetailLoading && (
        <div className="py-10 text-center">
          <Spin />
          <div className="mt-2 text-xs font-cairo">جارٍ قراءة بيانات المادة من الخادم…</div>
        </div>
      )}

      {isEditing && isDetailError && (
        <Alert
          type="error"
          showIcon
          className="my-4 rounded-xl font-cairo"
          message={<span className="font-bold text-xs">تعذّر قراءة بيانات المادة من الخادم</span>}
          description={
            <span className="text-xs">
              {toArabicErrorMessage(detailError, 'تعذّر جلب بيانات المادة')} — الحفظ معطَّل، لأن
              الكتابة ببيانات غير مقروءة تمحو القسم والمؤلف والملف المرتبط بالمادة.
            </span>
          }
        />
      )}

      {(!isEditing || detail) && (
        <Form form={form} layout="vertical" className="mt-4 font-cairo">
          {isCategoriesError && (
            <Alert
              type="error"
              showIcon
              className="mb-4 rounded-xl font-cairo"
              message={<span className="font-bold text-xs">تعذر تحميل قائمة الأقسام من الخادم</span>}
              description={
                <span className="text-xs">
                  {toArabicErrorMessage(categoriesError, 'تعذر جلب الأقسام')}
                  {' — '}
                  لا تُعرض أقسام تجريبية، لأن النشر إلى قسم غير موجود يُفقد المادة مكانها الصحيح.
                </span>
              }
            />
          )}

          {isEditing && detail && (
            <div className="mb-4 flex items-center gap-2">
              <Text className="text-xs">الحالة الحالية على الخادم:</Text>
              <Tag color={STATUS_COLOR[currentStatus] ?? 'default'}>
                {STATUS_LABEL_AR[currentStatus] ?? currentStatus}
              </Tag>
              <Text type="secondary" className="text-xs" dir="ltr">
                {detail.slug}
              </Text>
            </div>
          )}

          <Form.Item
            name="title"
            label={<span className="text-cream-200 font-bold">عنوان المحتوى / الفتوى / الدرس</span>}
            rules={[{ required: true, message: 'يرجى إدخال عنوان المحتوى' }]}
          >
            <Input placeholder="مثال: شرح كتاب التوحيد — الدرس الأول" size="large" />
          </Form.Item>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="categoryId"
              label={<span className="text-cream-200 font-bold">القسم / التصنيف (ديناميكي)</span>}
              rules={[{ required: true, message: 'يرجى اختيار القسم' }]}
            >
              <Select
                placeholder="اختر القسم..."
                size="large"
                notFoundContent={
                  isCategoriesError ? 'تعذر تحميل الأقسام من الخادم' : 'لا توجد أقسام متاحة'
                }
              >
                {categories.map((cat: any) => (
                  <Option key={cat.id} value={cat.id}>
                    {cat.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="authorId"
              label={<span className="text-cream-200 font-bold">المؤلف / المفتي</span>}
              extra={
                isAuthorsError ? (
                  <span className="text-xs text-red-400">
                    {toArabicErrorMessage(authorsError, 'تعذّر جلب قائمة المؤلفين')} — لا تُعرض
                    أسماء غير موجودة على الخادم.
                  </span>
                ) : undefined
              }
            >
              <Select
                allowClear
                placeholder="اختر المؤلف..."
                size="large"
                showSearch
                optionFilterProp="children"
                notFoundContent={
                  isAuthorsError ? 'تعذر تحميل المؤلفين من الخادم' : 'لا يوجد مؤلفون مسجّلون'
                }
              >
                {authors.map((a: any) => (
                  <Option key={a.id} value={a.id}>
                    {a.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="slug"
              label={<span className="text-cream-200 font-medium">الرابط المعرف (Slug)</span>}
              extra={
                isEditing ? (
                  <span className="text-xs">الرابط المعرف ثابت بعد الإنشاء (API-003).</span>
                ) : undefined
              }
              rules={[
                { required: true, message: 'يرجى إدخال الرابط المعرف' },
                { pattern: /^[a-z0-9-]+$/, message: 'يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطات فقط' },
              ]}
            >
              <Input placeholder="kitab-tawheed-01" dir="ltr" disabled={isEditing} />
            </Form.Item>

            <Form.Item
              name="type"
              label={<span className="text-cream-200 font-medium">نوع المادة</span>}
              extra={
                isEditing ? (
                  <span className="text-xs">لا يمكن تغيير نوع المادة بعد الإنشاء.</span>
                ) : undefined
              }
              rules={[{ required: true }]}
            >
              <Select disabled={isEditing} onChange={(v) => setSelectedType(v as string)}>
                <Option value="AUDIO">صوتي (Audio / درس مسموع)</Option>
                <Option value="TEXT">مقال / فتوى مكتوبة (Text)</Option>
                <Option value="PDF">كتاب / وثيقة (PDF)</Option>
                <Option value="IMAGE">صورة / مخطوطة (Image)</Option>
              </Select>
            </Form.Item>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="postSaveAction"
              label={<span className="text-cream-200 font-medium">الإجراء بعد الحفظ</span>}
              extra={
                <span className="text-xs">
                  النشر يمر بمسار المراجعة المعتمد (مسودة ← مراجعة ← منشور)، والنتيجة المُعلنة هي
                  ما يُعيده الخادم فعلاً.
                </span>
              }
              rules={[{ required: true }]}
            >
              <Select>
                {allowedActions(isEditing ? currentStatus : 'DRAFT').map((a) => (
                  <Option key={a.value} value={a.value}>
                    {a.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="primaryLocale"
              label={<span className="text-cream-200 font-medium">اللغة الأساسية</span>}
              extra={
                isEditing ? (
                  <span className="text-xs">اللغة الأساسية ثابتة بعد الإنشاء.</span>
                ) : undefined
              }
              rules={[{ required: true }]}
            >
              <Select disabled={isEditing}>
                <Option value="ar">العربية (ar)</Option>
                <Option value="en">English (en)</Option>
                <Option value="fr">Français (fr)</Option>
                <Option value="ur">اردو (ur)</Option>
                <Option value="ms">Bahasa Melayu (ms)</Option>
              </Select>
            </Form.Item>
          </div>

          {needsMedia && (
            <Form.Item
              name="mediaAssetId"
              label={<span className="text-cream-200 font-medium">ملف المادة (صوت / PDF / صورة)</span>}
            >
              <MediaUploadField contentType={selectedType} />
            </Form.Item>
          )}

          <Form.Item
            name="description"
            label={<span className="text-cream-200 font-medium">الملخص العلمي / الوصف</span>}
          >
            <TextArea rows={3} placeholder="وصف موجز للمادة أو الدرس..." className="font-amiri text-base leading-relaxed" />
          </Form.Item>

          {selectedType === 'TEXT' && (
            <Form.Item
              name="body"
              label={<span className="text-cream-200 font-medium">نص الفتوى / متن المقال</span>}
            >
              <TextArea rows={6} placeholder="اكتب متن المادة أو نص الفتوى كاملاً..." className="font-amiri text-base leading-relaxed" />
            </Form.Item>
          )}
        </Form>
      )}
    </Modal>
  );
};
