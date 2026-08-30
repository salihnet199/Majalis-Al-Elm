import React, { useState } from 'react';
import {
  Card,
  Input,
  Button,
  Table,
  Tag,
  Modal,
  Select,
  Radio,
  Typography,
  message,
  Tooltip,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  AppstoreOutlined,
  FolderOpenOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { toArabicErrorMessage } from '../../core/api/errorMessage';
import { queryKeys } from '../../core/queries/queryKeys';

const { Title, Text } = Typography;
const { Option } = Select;

interface CategoryItem {
  id: string;
  slug: string;
  name: string;
  contentCount?: number;
  createdAt?: string;
}

export const CategoriesScreen: React.FC = () => {
  const queryClient = useQueryClient();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isDeletingModalOpen, setIsDeletingModalOpen] = useState(false);
  const [selectedCategoryForDelete, setSelectedCategoryForDelete] = useState<CategoryItem | null>(null);
  const [reassignAction, setReassignAction] = useState<'MOVE' | 'UNCATEGORIZE'>('MOVE');
  const [targetCategoryId, setTargetCategoryId] = useState<string | null>(null);

  // 1. Fetch Categories dynamically from API
  //
  // SECURITY: no offline fallback. The five invented categories were especially
  // harmful here: each carried a fake contentCount, and contentCount decides
  // whether deletion goes through the reassignment modal or straight to DIRECT
  // delete — so fabricated counts could route a real deletion down the wrong path.
  const { data: categories = [], isLoading, isError, error, refetch } = useQuery<CategoryItem[]>({
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

  // 2. Mutation: Create New Category
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      // Generate slug from name
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\u0600-\u06FFa-zA-Z0-9-]/g, '') || `cat-${Date.now()}`;

      return apiClient.post('/admin/categories', {
        slug,
        translations: [{ locale: 'ar', name: name.trim() }],
      });
    },
    onSuccess: () => {
      message.success(`تمت إضافة قسم "${newCategoryName}" بنجاح.`);
      setNewCategoryName('');
      queryClient.invalidateQueries({ queryKey: queryKeys.content.categories() });
    },
    // SECURITY: the previous "optimistic success for offline demo" reported a
    // created category and cleared the input, so the typed name was lost and the
    // admin believed a section existed that the server had never accepted.
    onError: (err) => {
      message.error(toArabicErrorMessage(err, 'تعذر إضافة القسم، لم يُنشأ أي قسم على الخادم'));
    },
  });

  // 3. Mutation: Delete Category (with smart reassignment)
  const deleteMutation = useMutation({
    mutationFn: async ({
      categoryId,
      action,
      targetId,
    }: {
      categoryId: string;
      action: 'DIRECT' | 'MOVE' | 'UNCATEGORIZE';
      targetId?: string | null;
    }) => {
      return apiClient.delete(`/admin/categories/${categoryId}`, {
        params: { action, targetId },
      });
    },
    onSuccess: () => {
      message.success('تم حذف القسم وتحديث محتوياته بنجاح.');
      setIsDeletingModalOpen(false);
      setSelectedCategoryForDelete(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.content.categories() });
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
    },
    // SECURITY: the modal stays open with the chosen reassignment so the admin can
    // retry. Reporting a deletion that never happened also left the fate of the
    // linked material unknown.
    onError: (err) => {
      message.error(
        toArabicErrorMessage(err, 'تعذر حذف القسم، ولا يزال القسم ومحتوياته كما هما'),
      );
    },
  });

  // Handle Add Category Button
  const handleAddCategory = () => {
    if (!newCategoryName.trim()) {
      message.warning('يرجى كتابة اسم القسم أولاً.');
      return;
    }
    createMutation.mutate(newCategoryName);
  };

  // Handle Delete Click
  const handleDeleteClick = (category: CategoryItem) => {
    const itemCount = category.contentCount || 0;
    if (itemCount === 0) {
      // Direct deletion if 0 items
      deleteMutation.mutate({ categoryId: category.id, action: 'DIRECT' });
    } else {
      // Open Smart Reassignment Modal
      setSelectedCategoryForDelete(category);
      setReassignAction('MOVE');
      // Set default target category to first available other category
      const other = categories.find((c) => c.id !== category.id);
      setTargetCategoryId(other ? other.id : null);
      setIsDeletingModalOpen(true);
    }
  };

  // Confirm Reassign Deletion
  const handleConfirmReassignDelete = () => {
    if (!selectedCategoryForDelete) return;
    deleteMutation.mutate({
      categoryId: selectedCategoryForDelete.id,
      action: reassignAction,
      targetId: reassignAction === 'MOVE' ? targetCategoryId : null,
    });
  };

  const columns = [
    {
      title: 'اسم القسم',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: CategoryItem) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gold-500/15 border border-gold-500/30 flex items-center justify-center text-gold-400">
            <FolderOpenOutlined />
          </div>
          <div>
            <span className="font-bold text-cream-100 font-cairo text-sm sm:text-base">{name}</span>
            <div className="text-[11px] text-mocha-400 font-mono">slug: {record.slug}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'عدد المواد المنشورة',
      dataIndex: 'contentCount',
      key: 'contentCount',
      width: 170,
      render: (count = 0) => (
        <Tag
          color={count > 0 ? 'gold' : 'default'}
          className="font-cairo font-semibold px-2.5 py-0.5 rounded-full"
        >
          {count} {count === 1 ? 'مادة' : count === 2 ? 'مادتان' : 'مواد'}
        </Tag>
      ),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      width: 140,
      render: (_: any, record: CategoryItem) => {
        const hasContent = (record.contentCount || 0) > 0;
        return (
          <Tooltip title={hasContent ? 'حذف القسم ونقل المواد المرتبطة' : 'حذف القسم'}>
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteClick(record)}
              className="text-red-400 hover:text-red-300 hover:bg-red-950/30 font-cairo"
            >
              حذف
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-mocha-900 via-mocha-850 to-mocha-900 p-6 rounded-2xl border border-gold-500/30 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title level={3} className="!text-transparent !bg-clip-text !bg-gradient-to-r !from-gold-300 !to-gold-500 !mb-1 font-ruqaa font-bold">
            إدارة الأقسام والتصنيفات العلمية
          </Title>
          <Text className="text-cream-300 text-sm font-cairo">
            إضافة أقسام جديدة تظهر فوراً في نماذج النشر وتطبيق الهاتف، مع حماية وتنظيم المواد عند الحذف
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => refetch()}
          className="border-gold-500/40 text-gold-300 hover:text-gold-200 hover:border-gold-400 bg-mocha-800"
        >
          تحديث القائمة
        </Button>
      </div>

      {/* Load Failure Banner — replaces the deleted sample-category fallback */}
      {isError && (
        <Alert
          type="error"
          showIcon
          className="rounded-2xl font-cairo"
          message={<span className="font-bold">تعذر تحميل الأقسام من الخادم</span>}
          description={
            <span className="text-xs">
              {toArabicErrorMessage(error, 'تعذر جلب الأقسام، يرجى المحاولة مرة أخرى')}
              {' — '}
              لا تُعرض أقسام تجريبية، لأن عدد المواد المرتبط بها يحدد طريقة الحذف وقد يُعرّض المحتوى للخطر.
            </span>
          }
          action={
            <Button size="small" danger onClick={() => refetch()} className="font-cairo">
              إعادة المحاولة
            </Button>
          }
        />
      )}

      {/* Simplified Fast Add Category Form */}
      <Card
        className="border border-gold-500/30 bg-mocha-900/90 backdrop-blur-md rounded-2xl shadow-lg"
      >
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full sm:flex-1">
            <Input
              size="large"
              placeholder="اكتب اسم القسم الجديد (مثال: السيرة النبوية، الفتاوى المعاصرة...)"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onPressEnter={handleAddCategory}
              prefix={<AppstoreOutlined className="text-gold-400/80 ml-2" />}
              className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100 placeholder:text-mocha-400 focus:border-gold-500"
            />
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            loading={createMutation.isPending}
            onClick={handleAddCategory}
            className="w-full sm:w-auto h-11 px-6 font-bold font-cairo bg-gradient-to-r from-gold-600 via-gold-500 to-gold-600 text-mocha-950 rounded-xl shadow-md border-none"
          >
            إضافة القسم
          </Button>
        </div>
      </Card>

      {/* Categories List Table */}
      <Card
        className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="font-bold text-cream-100 font-cairo text-base flex items-center gap-2">
            <FolderOpenOutlined className="text-gold-400" />
            <span>الأقسام المتاحة حالياً ({isError ? '—' : categories.length})</span>
          </div>
        </div>

        <Table
          columns={columns}
          dataSource={categories}
          rowKey="id"
          loading={isLoading}
          locale={{
            emptyText: (
              <span className="font-cairo text-cream-300 text-sm">
                {isError
                  ? 'لا يمكن عرض الأقسام لتعذر الاتصال بالخادم'
                  : 'لا توجد أقسام مسجَّلة بعد'}
              </span>
            ),
          }}
          pagination={false}
          className="overflow-x-auto"
        />
      </Card>

      {/* ── Smart Reassignment Delete Modal ── */}
      <Modal
        open={isDeletingModalOpen}
        title={
          <div className="flex items-center gap-2 text-gold-400 font-bold font-cairo text-lg">
            <ExclamationCircleOutlined className="text-amber-400" />
            <span>تأكيد حذف قسم يحتوي على مواد منشورة</span>
          </div>
        }
        okText="تنفيذ الحذف والإجراء"
        cancelText="تراجع وإلغاء"
        onCancel={() => setIsDeletingModalOpen(false)}
        onOk={handleConfirmReassignDelete}
        confirmLoading={deleteMutation.isPending}
        okButtonProps={{ danger: true, className: 'font-cairo font-bold' }}
        cancelButtonProps={{ className: 'font-cairo' }}
        width={560}
      >
        {selectedCategoryForDelete && (
          <div className="py-2 space-y-4 font-cairo text-cream-200">
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-sm">
              يحتوي قسم <strong className="text-gold-300">"{selectedCategoryForDelete.name}"</strong> على{' '}
              <strong className="text-gold-300">({selectedCategoryForDelete.contentCount})</strong> مادة منشورة
              بالفعل. لحفظ تنظيم الموقع ومنع أي روابط معطلة، يرجى اختيار الإجراء المطلوب للمواد:
            </div>

            <Radio.Group
              value={reassignAction}
              onChange={(e) => setReassignAction(e.target.value)}
              className="flex flex-col gap-3 w-full"
            >
              {/* Option 1: Move to another Category */}
              <div
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  reassignAction === 'MOVE'
                    ? 'border-gold-500 bg-gold-500/10'
                    : 'border-mocha-700 bg-mocha-900/60'
                }`}
                onClick={() => setReassignAction('MOVE')}
              >
                <Radio value="MOVE" className="text-cream-100 font-bold">
                  نقل كافة المواد تلقائياً إلى قسم بديل (موصى به)
                </Radio>
                {reassignAction === 'MOVE' && (
                  <div className="mt-3 mr-6">
                    <Text className="text-xs text-cream-300 block mb-1.5">اختر القسم البديل:</Text>
                    <Select
                      value={targetCategoryId}
                      onChange={(val) => setTargetCategoryId(val)}
                      className="w-full font-cairo"
                      placeholder="اختر قسماً من القائمة..."
                    >
                      {categories
                        .filter((c) => c.id !== selectedCategoryForDelete.id)
                        .map((c) => (
                          <Option key={c.id} value={c.id}>
                            {c.name}
                          </Option>
                        ))}
                    </Select>
                  </div>
                )}
              </div>

              {/* Option 2: Set as Uncategorized */}
              <div
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  reassignAction === 'UNCATEGORIZE'
                    ? 'border-gold-500 bg-gold-500/10'
                    : 'border-mocha-700 bg-mocha-900/60'
                }`}
                onClick={() => setReassignAction('UNCATEGORIZE')}
              >
                <Radio value="UNCATEGORIZE" className="text-cream-100 font-bold">
                  تحويل المواد إلى "بلا تصنيف" (Uncategorized)
                </Radio>
                <p className="text-xs text-mocha-400 mt-1 mr-6">
                  ستبقى المواد منشورة في المنصة ولكن بدون قسم رئيسي حتى يُعاد تصنيفها لاحقاً.
                </p>
              </div>
            </Radio.Group>
          </div>
        )}
      </Modal>
    </div>
  );
};
