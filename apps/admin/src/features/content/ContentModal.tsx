import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, message, Alert } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { toArabicErrorMessage } from '../../core/api/errorMessage';
import { queryKeys } from '../../core/queries/queryKeys';
import { ContentItem } from '../../core/types/content.types';

const { Option } = Select;
const { TextArea } = Input;

interface ContentModalProps {
  open: boolean;
  initialData: ContentItem | null;
  onClose: () => void;
}

export const ContentModal: React.FC<ContentModalProps> = ({ open, initialData, onClose }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const isEditing = !!initialData;

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

  useEffect(() => {
    if (open) {
      if (initialData) {
        form.setFieldsValue({
          title: initialData.title,
          slug: initialData.slug,
          type: initialData.type,
          status: initialData.status,
          categoryId: initialData.categoryId || (initialData as any).category?.id,
          primaryLanguage: initialData.primaryLanguage || 'ar',
          authorName: initialData.authorName || 'فضيلة الشيخ علي الويسي',
          mediaUrl: initialData.mediaUrl || '',
          description: initialData.translations?.[0]?.description || '',
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          type: 'AUDIO',
          status: 'PUBLISHED',
          primaryLanguage: 'ar',
          authorName: 'فضيلة الشيخ علي الويسي',
          categoryId: categories[0]?.id,
        });
      }
    }
  }, [open, initialData, form, categories]);

  const saveMutation = useMutation({
    mutationFn: async (values: any) => {
      if (isEditing) {
        return apiClient.patch(`/admin/content/${initialData.slug}`, values);
      } else {
        return apiClient.post('/admin/content', values);
      }
    },
    onSuccess: () => {
      message.success(isEditing ? 'تم تحديث المحتوى بنجاح' : 'تم إضافة ونشر المحتوى بنجاح');
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
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

  return (
    <Modal
      open={open}
      title={
        <div className="font-ruqaa text-gold-400 font-bold text-xl">
          {isEditing ? 'تعديل المحتوى العلمي' : 'نشر محتوى جديد لمجالس العلم'}
        </div>
      }
      okText={isEditing ? 'حفظ التعديلات' : 'نشر المحتوى الآن'}
      cancelText="إلغاء"
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saveMutation.isPending}
      width={720}
      destroyOnClose
      okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
      cancelButtonProps={{ className: 'font-cairo' }}
    >
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
            name="authorName"
            label={<span className="text-cream-200 font-bold">المؤلف / المفتي</span>}
          >
            <Input placeholder="فضيلة الشيخ علي الويسي" size="large" />
          </Form.Item>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Form.Item
            name="slug"
            label={<span className="text-cream-200 font-medium">الرابط المعرف (Slug)</span>}
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
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="AUDIO">صوتي (Audio / درس مسموع)</Option>
              <Option value="TEXT">مقال / فتوى مكتوبة (Text)</Option>
              <Option value="PDF">كتاب / وثيقة (PDF)</Option>
              <Option value="IMAGE">صورة / مخطوطة (Image)</Option>
            </Select>
          </Form.Item>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Form.Item
            name="status"
            label={<span className="text-cream-200 font-medium">حالة النشر</span>}
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="PUBLISHED">منشور للعامة فوراً</Option>
              <Option value="DRAFT">مسودة خاصة</Option>
              <Option value="ARCHIVED">مؤرشف</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="primaryLanguage"
            label={<span className="text-cream-200 font-medium">اللغة الأساسية</span>}
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="ar">العربية (ar)</Option>
              <Option value="en">English (en)</Option>
              <Option value="fr">Français (fr)</Option>
              <Option value="ur">اردو (ur)</Option>
            </Select>
          </Form.Item>
        </div>

        <Form.Item
          name="mediaUrl"
          label={<span className="text-cream-200 font-medium">رابط الملف الصوتي / ملف الـ PDF</span>}
        >
          <Input placeholder="https://cdn.majalis-elm.app/media/audio/sample.mp3" dir="ltr" />
        </Form.Item>

        <Form.Item
          name="description"
          label={<span className="text-cream-200 font-medium">نص الفتوى / الملخص العلمي</span>}
        >
          <TextArea rows={4} placeholder="اكتب متن المادة أو نص الفتوى أو تفاصيل الدرس..." className="font-amiri text-base leading-relaxed" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

