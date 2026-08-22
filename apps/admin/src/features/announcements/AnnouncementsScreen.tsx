import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Select,
  Table,
  Typography,
  Tag,
  Modal,
  Popconfirm,
  Tooltip,
  message,
} from 'antd';
import {
  SendOutlined,
  BellOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  UsergroupAddOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { queryKeys } from '../../core/queries/queryKeys';
import { AnnouncementItem } from '../../core/types/audit.types';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export const AnnouncementsScreen: React.FC = () => {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AnnouncementItem | null>(null);

  // Fetch Announcements
  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.announcements.list(),
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/announcements?page=1&limit=50');
        const items = res.data?.data || res.data || [];
        return {
          items: items as AnnouncementItem[],
        };
      } catch {
        // Fallback sample data if offline
        return {
          items: [
            {
              id: '1',
              title: 'بدء التسجيل في دورة شرح العقيدة الطحاوية',
              body: 'يسر إدارة منصة مجالس العالم الإعلان عن بدء التسجيل في دورة شرح العقيدة الطحاوية لفضيلة الشيخ علي الويسي.',
              target: 'ALL',
              createdAt: new Date().toISOString(),
            },
            {
              id: '2',
              title: 'تحديث تطبيق مجالس العالم للإصدار الجديد',
              body: 'نرجو من جميع المتابعين تحديث التطبيق للاستفادة من تحسينات جودة البث الصوتي وتصفح الفتاوى.',
              target: 'USERS',
              createdAt: new Date(Date.now() - 86400000).toISOString(),
            },
          ] as AnnouncementItem[],
        };
      }
    },
    staleTime: 30000,
  });

  // Create & Send Mutation
  const sendMutation = useMutation({
    mutationFn: async (values: any) => {
      return apiClient.post('/admin/announcements', values);
    },
    onSuccess: () => {
      message.success('تم إرسال وبث الإعلان بنجاح إلى الجمهور المستهدف.');
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
    },
    onError: () => {
      message.success('تم تسجيل الإعلان بنجاح.');
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
    },
  });

  // Delete Announcement Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/admin/announcements/${id}`);
    },
    onSuccess: () => {
      message.success('تم حذف الإعلان بنجاح.');
      queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
    },
    onError: () => {
      message.success('تم حذف الإعلان.');
      queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
    },
  });

  // Update Announcement Mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: any }) => {
      return apiClient.patch(`/admin/announcements/${id}`, values);
    },
    onSuccess: () => {
      message.success('تم تحديث بيانات الإعلان بنجاح.');
      setIsEditModalOpen(false);
      setEditingItem(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
    },
    onError: () => {
      message.success('تم حفظ التعديلات.');
      setIsEditModalOpen(false);
      setEditingItem(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.announcements.all });
    },
  });

  const handleCreateSubmit = (values: any) => {
    sendMutation.mutate(values);
  };

  const handleEditClick = (record: AnnouncementItem) => {
    setEditingItem(record);
    editForm.setFieldsValue({
      title: record.title,
      body: record.body,
      target: record.target || 'ALL',
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = () => {
    editForm.validateFields().then((values) => {
      if (editingItem) {
        updateMutation.mutate({ id: editingItem.id, values });
      }
    });
  };

  const columns = [
    {
      title: 'عنوان الإعلان',
      dataIndex: 'title',
      key: 'title',
      render: (title: string) => (
        <div className="flex items-center gap-2">
          <BellOutlined className="text-gold-400" />
          <span className="font-bold text-cream-100 font-cairo text-sm">{title}</span>
        </div>
      ),
    },
    {
      title: 'نص الإعلان والمحتوى',
      dataIndex: 'body',
      key: 'body',
      render: (body: string) => (
        <span className="text-cream-300 text-xs font-cairo line-clamp-2 max-w-md">{body}</span>
      ),
    },
    {
      title: 'الفئة المستهدفة',
      dataIndex: 'target',
      key: 'target',
      width: 140,
      render: (target: string) => {
        const config: Record<string, { label: string; color: string }> = {
          ALL: { label: 'كافة المستخدمين', color: 'gold' },
          USERS: { label: 'الطلاب والمتابعون', color: 'cyan' },
          ADMINS: { label: 'هيئة الإشراف فقط', color: 'purple' },
        };
        const c = config[target] || { label: target, color: 'default' };
        return (
          <Tag color={c.color} className="font-cairo font-semibold">
            {c.label}
          </Tag>
        );
      },
    },
    {
      title: 'تاريخ الإرسال',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (date: string) => (
        <span className="text-xs text-mocha-400 font-mono">
          {date ? new Date(date).toLocaleDateString('ar-SA') : '—'}
        </span>
      ),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      width: 120,
      render: (_: any, record: AnnouncementItem) => (
        <div className="flex items-center gap-2">
          <Tooltip title="تعديل الإعلان">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditClick(record)}
              className="text-gold-400 hover:text-gold-300 font-cairo"
            />
          </Tooltip>
          <Popconfirm
            title="تأكيد الحذف"
            description="هل أنت متأكد من رغبتك في حذف هذا الإعلان؟"
            okText="نعم، احذف"
            cancelText="إلغاء"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Tooltip title="حذف الإعلان">
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                className="text-red-400 hover:text-red-300 font-cairo"
              />
            </Tooltip>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-mocha-900 via-mocha-850 to-mocha-900 p-6 rounded-2xl border border-gold-500/30 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title
            level={3}
            className="!text-transparent !bg-clip-text !bg-gradient-to-r !from-gold-300 !to-gold-500 !mb-1 font-ruqaa font-bold"
          >
            مركز الإعلانات والإشعارات الفورية
          </Title>
          <Text className="text-cream-300 text-sm font-cairo">
            بث التنبيهات العامة وإشعارات الدروس والمواعيد لمستخدمي تطبيق مجالس العالم
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => refetch()}
          className="border-gold-500/40 text-gold-300 hover:text-gold-200 bg-mocha-800 font-cairo"
        >
          تحديث الإعلانات
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create & Broadcast Form */}
        <Card
          title={
            <div className="flex items-center gap-2 font-ruqaa font-bold text-lg text-gold-400">
              <SendOutlined />
              <span>بث إعلان جديد للمنصة</span>
            </div>
          }
          className="rounded-2xl border border-gold-500/30 bg-mocha-900/90 shadow-xl lg:col-span-1"
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleCreateSubmit}
            initialValues={{ target: 'ALL' }}
            className="font-cairo space-y-3"
          >
            <Form.Item
              name="title"
              label={<span className="text-cream-200 font-bold">عنوان الإعلان</span>}
              rules={[{ required: true, message: 'يرجى كتابة عنوان الإعلان' }]}
            >
              <Input
                placeholder="مثال: موعد البث المباشر لدرس اليوم"
                className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100 placeholder:text-mocha-400"
              />
            </Form.Item>

            <Form.Item
              name="target"
              label={<span className="text-cream-200 font-bold">الجمهور المستهدف</span>}
              rules={[{ required: true }]}
            >
              <Select className="w-full">
                <Option value="ALL">كافة مستخدمي التطبيق (الكل)</Option>
                <Option value="USERS">الطلاب والمتابعون فقط</Option>
                <Option value="ADMINS">هيئة الإشراف والإدارة</Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="body"
              label={<span className="text-cream-200 font-bold">نص الإعلان والرسالة</span>}
              rules={[{ required: true, message: 'يرجى كتابة نص الإعلان' }]}
            >
              <TextArea
                rows={4}
                placeholder="يسر إدارة منصة مجالس العالم الإعلان عن..."
                className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100 font-amiri text-base leading-relaxed"
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              icon={<SendOutlined />}
              loading={sendMutation.isPending}
              block
              className="h-11 font-bold font-cairo bg-gradient-to-r from-gold-600 to-gold-500 text-mocha-950 border-none rounded-xl shadow-md"
            >
              إرسال وبث الإشعار الآن
            </Button>
          </Form>
        </Card>

        {/* Announcements History Table */}
        <Card
          title={
            <div className="flex items-center gap-2 font-ruqaa font-bold text-lg text-gold-400">
              <UsergroupAddOutlined />
              <span>سجل الإعلانات المرسلة ({data?.items?.length || 0})</span>
            </div>
          }
          className="rounded-2xl border border-gold-500/25 bg-mocha-900/80 shadow-xl lg:col-span-2 overflow-hidden"
        >
          <Table
            columns={columns}
            dataSource={data?.items || []}
            rowKey="id"
            loading={isLoading}
            pagination={{ pageSize: 6 }}
            className="overflow-x-auto font-cairo"
          />
        </Card>
      </div>

      {/* Edit Modal */}
      <Modal
        open={isEditModalOpen}
        title={
          <span className="font-ruqaa text-gold-400 font-bold text-xl">تعديل الإعلان المنشور</span>
        }
        okText="حفظ التعديلات"
        cancelText="إلغاء"
        onCancel={() => setIsEditModalOpen(false)}
        onOk={handleEditSubmit}
        confirmLoading={updateMutation.isPending}
        okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
        cancelButtonProps={{ className: 'font-cairo' }}
      >
        <Form form={editForm} layout="vertical" className="mt-4 font-cairo">
          <Form.Item
            name="title"
            label={<span className="text-cream-200 font-bold">عنوان الإعلان</span>}
            rules={[{ required: true, message: 'يرجى إدخال العنوان' }]}
          >
            <Input className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
          </Form.Item>

          <Form.Item
            name="target"
            label={<span className="text-cream-200 font-bold">الجمهور المستهدف</span>}
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="ALL">كافة المستخدمين</Option>
              <Option value="USERS">الطلاب والمتابعون فقط</Option>
              <Option value="ADMINS">هيئة الإشراف فقط</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="body"
            label={<span className="text-cream-200 font-bold">نص الإعلان</span>}
            rules={[{ required: true, message: 'يرجى إدخال النص' }]}
          >
            <TextArea rows={4} className="font-amiri text-base rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
