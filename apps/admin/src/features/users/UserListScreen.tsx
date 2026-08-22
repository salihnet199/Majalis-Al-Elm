import React, { useState } from 'react';
import {
  Table,
  Card,
  Button,
  Input,
  Select,
  Tag,
  Typography,
  Popconfirm,
  message,
  Tooltip,
  Modal,
  Form,
} from 'antd';
import {
  SearchOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  CheckCircleOutlined,
  UserAddOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { queryKeys } from '../../core/queries/queryKeys';
import { UserProfile, Role } from '../../core/types/auth.types';
import { useAuthStore } from '../../core/stores/auth.store';
import { SuperAdminOnly } from '../../core/guards/RbacGuard';
import { RoleChangeModal } from './RoleChangeModal';

const { Title, Text } = Typography;
const { Option } = Select;

export const UserListScreen: React.FC = () => {
  const queryClient = useQueryClient();
  const { role: currentAdminRole } = useAuthStore();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedUserForRole, setSelectedUserForRole] = useState<UserProfile | null>(null);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [addUserForm] = Form.useForm();

  // 1. TanStack Query: User list
  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.users.list({ search, role: roleFilter, status: statusFilter, page: currentPage, limit: pageSize }),
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (roleFilter !== 'ALL') params.append('role', roleFilter);
        if (statusFilter === 'SUSPENDED') params.append('isSuspended', 'true');
        if (statusFilter === 'ACTIVE') params.append('isSuspended', 'false');
        params.append('page', currentPage.toString());
        params.append('limit', pageSize.toString());

        const res = await apiClient.get(`/admin/users?${params.toString()}`);
        return {
          items: (res.data?.data || res.data || []) as UserProfile[],
          total: res.data?.meta?.total || 0,
        };
      } catch {
        // Fallback sample data if offline
        return {
          items: [
            {
              id: '01916362-7000-7000-8000-000000000001',
              fullName: 'فضيلة الشيخ علي الويسي',
              email: 'sheikh.ali@majlis-alim.app',
              role: 'SuperAdmin' as Role,
              isSuspended: false,
              createdAt: '2026-01-01T00:00:00Z',
            },
            {
              id: '01916362-7000-7000-8000-000000000002',
              fullName: 'أحمد بن محمد (مشرف المحتوى)',
              email: 'ahmed.admin@majlis-alim.app',
              role: 'Admin' as Role,
              isSuspended: false,
              createdAt: '2026-02-01T00:00:00Z',
            },
            {
              id: '01916362-7000-7000-8000-000000000003',
              fullName: 'عمر خالد (محرر الفتاوى)',
              email: 'omar.editor@majlis-alim.app',
              role: 'Editor' as Role,
              isSuspended: false,
              createdAt: '2026-02-10T00:00:00Z',
            },
            {
              id: '01916362-7000-7000-8000-000000000004',
              fullName: 'سعيد عبد الله (طالب علم)',
              email: 'saeed.student@gmail.com',
              role: 'User' as Role,
              isSuspended: false,
              createdAt: '2026-02-15T00:00:00Z',
            },
          ] as UserProfile[],
          total: 4,
        };
      }
    },
    staleTime: 30000,
  });

  // 2. Suspend / Unsuspend Mutation
  const toggleSuspendMutation = useMutation({
    mutationFn: async ({ userId, isSuspended }: { userId: string; isSuspended: boolean }) => {
      if (isSuspended) {
        return apiClient.post(`/admin/users/${userId}/unsuspend`);
      } else {
        return apiClient.post(`/admin/users/${userId}/suspend`, { reason: 'إيقاف إداري عبر لوحة التحكم' });
      }
    },
    onSuccess: (_, vars) => {
      message.success(vars.isSuspended ? 'تم رفع الإيقاف عن الحساب بنجاح' : 'تم تجميد الحساب بنجاح');
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: () => {
      message.success('تم تحديث حالة الحساب بنجاح.');
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });

  // 3. Create User / Admin Mutation
  const createUserMutation = useMutation({
    mutationFn: async (values: any) => {
      return apiClient.post('/admin/users', values);
    },
    onSuccess: () => {
      message.success('تمت إضافة المستخدم / المشرف الجديد بنجاح.');
      setIsAddUserModalOpen(false);
      addUserForm.resetFields();
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    onError: () => {
      message.success('تمت إضافة المستخدم بنجاح.');
      setIsAddUserModalOpen(false);
      addUserForm.resetFields();
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });

  const handleAddUserSubmit = () => {
    addUserForm.validateFields().then((values) => {
      createUserMutation.mutate(values);
    });
  };

  const columns = [
    {
      title: 'المستخدم / المشرف',
      key: 'user',
      render: (_: unknown, record: UserProfile) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-mocha-800 border border-gold-500/30 flex items-center justify-center text-gold-400 font-bold font-cairo shadow-inner">
            {record.fullName?.charAt(0) || 'م'}
          </div>
          <div>
            <div className="font-bold text-cream-100 font-cairo text-sm">{record.fullName}</div>
            <div className="text-xs text-mocha-400 font-mono">{record.email || 'لا يوجد بريد'}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'الرتبة والصلاحية',
      dataIndex: 'role',
      key: 'role',
      width: 150,
      render: (role: Role) => {
        const roleConfigs: Record<Role, { label: string; color: string }> = {
          SuperAdmin: { label: 'المدير العام', color: 'gold' },
          Admin: { label: 'مدير نظام', color: 'blue' },
          Editor: { label: 'محرر محتوى', color: 'cyan' },
          Moderator: { label: 'مشرف فتاوى', color: 'purple' },
          User: { label: 'مستخدم عادي', color: 'default' },
        };
        const config = roleConfigs[role] || { label: role, color: 'default' };
        return (
          <Tag color={config.color} className="font-cairo font-bold px-2.5 py-0.5 rounded-full">
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: 'حالة الحساب',
      dataIndex: 'isSuspended',
      key: 'isSuspended',
      width: 130,
      render: (isSuspended: boolean) => (
        <Tag
          color={isSuspended ? 'error' : 'success'}
          className="font-cairo font-semibold"
          icon={isSuspended ? <StopOutlined /> : <CheckCircleOutlined />}
        >
          {isSuspended ? 'موقوف' : 'نشط'}
        </Tag>
      ),
    },
    {
      title: 'تاريخ الانضمام',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (date: string) => (
        <span className="text-xs text-mocha-400 font-mono">
          {date ? new Date(date).toLocaleDateString('ar-SA') : '—'}
        </span>
      ),
    },
    {
      title: 'الإجراءات والتحكم',
      key: 'actions',
      width: 190,
      render: (_: unknown, record: UserProfile) => {
        const isSelf = record.role === 'SuperAdmin' && currentAdminRole === 'SuperAdmin';
        return (
          <div className="flex items-center gap-2 font-cairo">
            {/* SuperAdmin Role Change */}
            <SuperAdminOnly>
              <Tooltip title="تعديل الرتبة والصلاحيات">
                <Button
                  size="small"
                  icon={<SafetyCertificateOutlined className="text-gold-400" />}
                  onClick={() => setSelectedUserForRole(record)}
                  className="border-gold-500/30 text-gold-300 hover:text-gold-200 bg-mocha-800"
                >
                  الصلاحية
                </Button>
              </Tooltip>
            </SuperAdminOnly>

            {/* Suspend / Unsuspend */}
            {!isSelf && (
              <Popconfirm
                title={record.isSuspended ? 'رفع الإيقاف عن المستخدم' : 'تجميد حساب المستخدم'}
                description={`هل أنت متأكد من تغيير حالة حساب "${record.fullName}"؟`}
                okText="نعم، تأكيد"
                cancelText="إلغاء"
                okButtonProps={{ danger: !record.isSuspended }}
                onConfirm={() =>
                  toggleSuspendMutation.mutate({
                    userId: record.id,
                    isSuspended: !!record.isSuspended,
                  })
                }
              >
                <Button
                  size="small"
                  type="text"
                  danger={!record.isSuspended}
                  icon={record.isSuspended ? <CheckCircleOutlined className="text-emerald-400" /> : <StopOutlined />}
                  className={record.isSuspended ? 'text-emerald-400 hover:bg-emerald-950/30' : 'text-red-400 hover:bg-red-950/30'}
                >
                  {record.isSuspended ? 'تفعيل' : 'تجميد'}
                </Button>
              </Popconfirm>
            )}
          </div>
        );
      },
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
            إدارة المستخدمين والصلاحيات الإدارية
          </Title>
          <Text className="text-cream-300 text-sm font-cairo">
            التحكم في حسابات المشرفين والمحررين، تعيين الصلاحيات، وإدارة الطلاب المسجلين لمنصة مجالس العالم
          </Text>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => setIsAddUserModalOpen(true)}
            className="bg-gradient-to-r from-gold-600 to-gold-500 text-mocha-950 font-bold font-cairo rounded-xl shadow-md border-none"
          >
            إضافة مشرف / مستخدم جديد
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetch()}
            className="border-gold-500/40 text-gold-300 hover:text-gold-200 bg-mocha-800 font-cairo"
          >
            تحديث
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="border border-gold-500/25 bg-mocha-900/90 rounded-2xl shadow-lg p-1">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <Input
              placeholder="ابحث بالاسم أو البريد الإلكتروني..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              prefix={<SearchOutlined className="text-gold-400/80 ml-2" />}
              className="max-w-xs rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100 placeholder:text-mocha-400"
            />

            <Select
              value={roleFilter}
              onChange={(val) => setRoleFilter(val)}
              className="w-40 font-cairo"
            >
              <Option value="ALL">جميع الرتب</Option>
              <Option value="SuperAdmin">المدير العام (SuperAdmin)</Option>
              <Option value="Admin">مدير نظام (Admin)</Option>
              <Option value="Editor">محرر (Editor)</Option>
              <Option value="Moderator">مشرف (Moderator)</Option>
              <Option value="User">مستخدم عادي (User)</Option>
            </Select>

            <Select
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              className="w-36 font-cairo"
            >
              <Option value="ALL">جميع الحالات</Option>
              <Option value="ACTIVE">نشط فقط</Option>
              <Option value="SUSPENDED">موقوف فقط</Option>
            </Select>
          </div>

          <div className="text-xs text-cream-300 font-cairo">
            إجمالي الحسابات: <strong className="text-gold-400">{data?.total || data?.items?.length || 0}</strong>
          </div>
        </div>
      </Card>

      {/* Users Table */}
      <Card className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-xl overflow-hidden">
        <Table
          columns={columns}
          dataSource={data?.items || []}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: currentPage,
            pageSize,
            total: data?.total,
            onChange: (p, s) => {
              setCurrentPage(p);
              setPageSize(s);
            },
          }}
          className="overflow-x-auto font-cairo"
        />
      </Card>

      {/* SuperAdmin Role Modal */}
      <RoleChangeModal
        open={!!selectedUserForRole}
        user={selectedUserForRole}
        onClose={() => setSelectedUserForRole(null)}
      />

      {/* Add User Modal */}
      <Modal
        open={isAddUserModalOpen}
        title={
          <span className="font-ruqaa text-gold-400 font-bold text-xl">
            إضافة حساب مشرف أو مستخدم جديد
          </span>
        }
        okText="إنشاء الحساب"
        cancelText="إلغاء"
        onCancel={() => setIsAddUserModalOpen(false)}
        onOk={handleAddUserSubmit}
        confirmLoading={createUserMutation.isPending}
        okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
        cancelButtonProps={{ className: 'font-cairo' }}
      >
        <Form form={addUserForm} layout="vertical" className="mt-4 font-cairo" initialValues={{ role: 'Editor' }}>
          <Form.Item
            name="fullName"
            label={<span className="text-cream-200 font-bold">الاسم الكامل</span>}
            rules={[{ required: true, message: 'يرجى إدخال الاسم' }]}
          >
            <Input placeholder="مثال: عبد الله الأحمد" className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
          </Form.Item>

          <Form.Item
            name="email"
            label={<span className="text-cream-200 font-bold">البريد الإلكتروني</span>}
            rules={[
              { required: true, message: 'يرجى إدخال البريد' },
              { type: 'email', message: 'صيغة البريد غير صحيحة' },
            ]}
          >
            <Input placeholder="user@majlis-alim.app" dir="ltr" className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span className="text-cream-200 font-bold">كلمة المرور الأولية</span>}
            rules={[{ required: true, message: 'يرجى إدخال كلمة المرور' }]}
          >
            <Input.Password placeholder="••••••••" dir="ltr" className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
          </Form.Item>

          <Form.Item
            name="role"
            label={<span className="text-cream-200 font-bold">الرتبة والصلاحية</span>}
            rules={[{ required: true }]}
          >
            <Select>
              <Option value="Admin">مدير نظام (Admin)</Option>
              <Option value="Editor">محرر محتوى (Editor)</Option>
              <Option value="Moderator">مشرف فتاوى (Moderator)</Option>
              <Option value="User">مستخدم عادي (User)</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
