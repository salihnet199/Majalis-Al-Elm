import React, { useState } from 'react';
import { Table, Card, Button, Input, Select, Tag, Space, Typography, Popconfirm, message, Tooltip, Alert } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  DeleteOutlined,
  EditOutlined,
  SoundOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  PictureOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { toArabicErrorMessage } from '../../core/api/errorMessage';
import { queryKeys } from '../../core/queries/queryKeys';
import { AdminContentRow, ContentType, ContentStatus } from '../../core/types/content.types';
import { ContentModal } from './ContentModal';
import { BulkUploadDrawer } from './BulkUploadDrawer';

const { Title, Text } = Typography;
const { Option } = Select;

/**
 * The editor's content list.
 *
 * It reads `GET /admin/content` — the admin projection. It used to read `GET
 * /content`, the public catalogue, which meant drafts were invisible, `total` was
 * always 0 above a table with rows in it, and the search box and status filter
 * were sent to an endpoint that does not accept them. See the comment on
 * AdminContentController.listContent for the full account.
 */

const STATUS_META: Record<ContentStatus, { color: string; label: string }> = {
  DRAFT: { color: 'warning', label: 'مسودة' },
  REVIEW: { color: 'processing', label: 'قيد المراجعة' },
  PUBLISHED: { color: 'success', label: 'منشور' },
  ARCHIVED: { color: 'default', label: 'مؤرشف' },
};

export const ContentListScreen: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ContentType | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<ContentStatus | 'ALL'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AdminContentRow | null>(null);
  const [isBulkDrawerOpen, setIsBulkDrawerOpen] = useState(false);

  // TanStack Query: Content list with server-side pagination & filter
  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.content.list({ search, type: typeFilter, status: statusFilter, page: currentPage, limit: pageSize }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (typeFilter !== 'ALL') params.append('type', typeFilter);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const res = await apiClient.get(`/admin/content?${params.toString()}`);
      return {
        items: (res.data?.data ?? []) as AdminContentRow[],
        // No `?? items.length` fallback: a missing total is a contract change, and
        // inventing one from the current page makes a 12-page list look like one.
        total: res.data?.meta?.total ?? 0,
      };
    },
    staleTime: 30000,
    retry: 1,
  });

  // TanStack Mutation: Delete Content
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // By id. `DELETE /admin/content/:id` was being called with the slug, so it
      // answered 404 for every row and the error toast blamed permissions.
      await apiClient.delete(`/admin/content/${id}`);
    },
    onSuccess: () => {
      message.success('تم حذف المحتوى بنجاح');
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
    },
    onError: (err) => {
      message.error(toArabicErrorMessage(err, 'تعذر حذف المحتوى'));
    },
  });

  const columns = [
    {
      title: 'العنوان',
      dataIndex: 'title',
      key: 'title',
      render: (title: string | null, record: AdminContentRow) => (
        <div>
          {title ? (
            <div className="font-bold text-slate-100">{title}</div>
          ) : (
            <div className="font-bold text-amber-400">— بلا عنوان في هذه اللغة —</div>
          )}
          <div className="text-xs text-slate-400 font-mono">slug: {record.slug}</div>
        </div>
      ),
    },
    {
      title: 'النوع',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: ContentType) => {
        const typeConfig: Record<ContentType, { color: string; icon: React.ReactNode; label: string }> = {
          AUDIO: { color: 'blue', icon: <SoundOutlined />, label: 'صوتي' },
          PDF: { color: 'orange', icon: <FilePdfOutlined />, label: 'كتاب / PDF' },
          TEXT: { color: 'green', icon: <FileTextOutlined />, label: 'مقال / نص' },
          IMAGE: { color: 'purple', icon: <PictureOutlined />, label: 'صورة / مخطوطة' },
        };
        const config = typeConfig[type] || { color: 'default', icon: null, label: type };
        return (
          <Tag color={config.color} icon={config.icon} className="font-medium">
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: 'الحالة',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: ContentStatus) => {
        // An unknown status is shown verbatim rather than folded into "مؤرشف":
        // mislabelling a state is how REVIEW items were reported as archived.
        const meta = STATUS_META[status] ?? { color: 'default', label: status };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'الملف',
      key: 'media',
      width: 110,
      render: (_: unknown, record: AdminContentRow) =>
        record.type === 'TEXT' ? (
          <Text type="secondary" className="text-xs">—</Text>
        ) : record.mediaAssetId ? (
          <Tag color="cyan" className="font-medium">مرتبط</Tag>
        ) : (
          <Tag color="warning" className="font-medium">بلا ملف</Tag>
        ),
    },
    {
      title: 'المشاهدات',
      key: 'stats',
      width: 120,
      render: (_: unknown, record: AdminContentRow) => (
        <div className="text-xs font-mono text-slate-300">👁️ {record.viewCount || 0} مشاهدة</div>
      ),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: AdminContentRow) => (
        <Space direction="horizontal" size="small">
          <Tooltip title="تعديل">
            <Button
              type="text"
              icon={<EditOutlined className="text-blue-400" />}
              onClick={() => {
                setEditingItem(record);
                setIsModalOpen(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="حذف المحتوى"
            description="هل أنت متأكد من رغبتك في حذف هذا المحتوى؟"
            okText="نعم، احذف"
            cancelText="إلغاء"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Tooltip title="حذف">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title level={3} className="!text-slate-100 !mb-1 font-bold">
            إدارة المحتوى التعليمي
          </Title>
          <Text className="text-slate-400 text-sm">
            إضافة، تعديل، ونشر المواد الصوتية، الكتب والوثائق، المقالات والصور
          </Text>
        </div>
        <Space wrap>
          <Button
            id="bulk-upload-btn"
            icon={<CloudUploadOutlined />}
            onClick={() => setIsBulkDrawerOpen(true)}
            className="rounded-lg h-10 px-4 font-semibold border-slate-600 text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
          >
            رفع بالجملة
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingItem(null);
              setIsModalOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-lg h-10 px-5 font-bold"
          >
            إضافة محتوى جديد
          </Button>
        </Space>
      </div>

      {/* A failed list read must not look like an empty library. */}
      {isError && (
        <Alert
          type="error"
          showIcon
          className="rounded-xl font-cairo"
          message={<span className="font-bold text-xs">تعذر تحميل قائمة المحتوى من الخادم</span>}
          description={
            <span className="text-xs">
              {toArabicErrorMessage(error, 'تعذر جلب قائمة المحتوى')} — لا تُعرض مواد تجريبية،
              والجدول أدناه فارغ لأن القائمة لم تُقرأ، لا لأن المنصة بلا محتوى.
            </span>
          }
        />
      )}

      {/* Filters Bar */}
      <Card className="rounded-xl border border-slate-700/60 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            placeholder="البحث بالعنوان أو الرابط المعرف (Slug)..."
            prefix={<SearchOutlined className="text-slate-500" />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            allowClear
            className="rounded-lg"
          />
          <Select
            value={typeFilter}
            onChange={(val) => {
              setTypeFilter(val);
              setCurrentPage(1);
            }}
            className="w-full rounded-lg"
          >
            <Option value="ALL">جميع الأنواع</Option>
            <Option value="AUDIO">المواد الصوتية</Option>
            <Option value="PDF">الكتب وملفات PDF</Option>
            <Option value="TEXT">المقالات والنصوص</Option>
            <Option value="IMAGE">الصور والمخطوطات</Option>
          </Select>
          <Select
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val);
              setCurrentPage(1);
            }}
            className="w-full rounded-lg"
          >
            <Option value="ALL">جميع الحالات</Option>
            <Option value="DRAFT">مسودة</Option>
            <Option value="REVIEW">قيد المراجعة</Option>
            <Option value="PUBLISHED">منشور</Option>
            <Option value="ARCHIVED">مؤرشف</Option>
          </Select>
        </div>
      </Card>

      {/* Content Table */}
      <Card className="rounded-xl border border-slate-700/60 shadow-sm">
        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: data?.total || 0,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total) => `${total} مادة`,
          }}
          locale={{
            emptyText: isError
              ? 'لم تُقرأ القائمة من الخادم — راجع رسالة الخطأ أعلاه'
              : 'لا يوجد محتوى يطابق خيارات البحث',
          }}
        />
      </Card>

      {/* Content Modal (Create/Edit) */}
      <ContentModal
        open={isModalOpen}
        initialData={editingItem}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
      />

      {/* Bulk Upload Drawer */}
      <BulkUploadDrawer
        open={isBulkDrawerOpen}
        onClose={() => setIsBulkDrawerOpen(false)}
      />
    </div>
  );
};
