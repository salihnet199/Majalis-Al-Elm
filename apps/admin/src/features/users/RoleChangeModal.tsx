import React, { useEffect } from 'react';
import { Modal, Form, Select, Alert, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { queryKeys } from '../../core/queries/queryKeys';
import { UserProfile, Role, ASSIGNABLE_ROLES } from '../../core/types/auth.types';
import { useAuthStore } from '../../core/stores/auth.store';
import type { AxiosError } from 'axios';

const { Option } = Select;

interface RoleChangeModalProps {
  open: boolean;
  user: UserProfile | null;
  onClose: () => void;
}

export const RoleChangeModal: React.FC<RoleChangeModalProps> = ({ open, user, onClose }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { role: currentAdminRole } = useAuthStore();

  useEffect(() => {
    if (open && user) {
      const initialRole = ASSIGNABLE_ROLES.includes(user.role) ? user.role : 'User';
      form.setFieldsValue({ role: initialRole });
    }
  }, [open, user, form]);

  const changeRoleMutation = useMutation({
    mutationFn: async (newRole: Role) => {
      if (!user) throw new Error('No user selected');
      return apiClient.patch(`/admin/users/${user.id}/role`, { role: newRole });
    },
    onSuccess: () => {
      message.success(`تم تعديل دور وصلاحية "${user?.fullName}" بنجاح.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      onClose();
    },
    onError: (err: AxiosError<{ error?: { message?: string } }>) => {
      message.error(err.response?.data?.error?.message || 'فشلت عملية تعديل الدور. تأكد من امتلاك صلاحية SuperAdmin.');
    },
  });

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      changeRoleMutation.mutate(values.role);
    });
  };

  if (currentAdminRole !== 'SuperAdmin') {
    return (
      <Modal open={open} onCancel={onClose} footer={null} title="تنبيه أمني">
        <Alert
          type="error"
          message="صلاحية مرفوضة"
          description="تعديل أدوار المستخدمين مقصور حصرياً على رتبة SuperAdmin وفق السياسة الأمنية للمنصة."
          showIcon
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={
        <span className="font-ruqaa text-gold-400 font-bold text-xl">
          تعديل صلاحيات ودور المستخدم
        </span>
      }
      okText="تأكيد وتطبيق الدور"
      cancelText="إلغاء"
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={changeRoleMutation.isPending}
      destroyOnClose
      okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
      cancelButtonProps={{ className: 'font-cairo' }}
    >
      <div className="space-y-4 my-4 font-cairo">
        <div className="p-3.5 bg-mocha-950/80 rounded-xl border border-gold-500/30">
          <div className="text-xs text-mocha-400">المستخدم المستهدف:</div>
          <div className="font-bold text-cream-100 text-base">{user?.fullName}</div>
          <div className="text-xs text-cream-300 font-mono">{user?.email}</div>
          <div className="text-xs text-gold-400 font-semibold mt-1">الدور الحالي: {user?.role}</div>
        </div>

        <Alert
          type="info"
          message="ضوابط الصلاحيات الإدارية"
          description="يمكنك تعيين أحد الأدوار الأربعة المعتمدة (Admin, Editor, Moderator, User). دور SuperAdmin محجوز ولا يمكن تعيينه عشوائياً."
          showIcon
          className="text-xs rounded-xl bg-mocha-900 border border-gold-500/20 text-cream-200"
        />

        <Form form={form} layout="vertical">
          <Form.Item
            name="role"
            label={<span className="font-bold text-cream-200">الدور والصلاحية الجديدة</span>}
            rules={[{ required: true, message: 'يرجى اختيار الدور' }]}
          >
            <Select size="large" className="w-full font-cairo">
              {ASSIGNABLE_ROLES.map((r) => (
                <Option key={r} value={r}>
                  {r === 'Admin'
                    ? 'مدير نظام (Admin) — إدارة شاملة'
                    : r === 'Editor'
                    ? 'محرر محتوى (Editor) — إنشاء وتعديل المواد'
                    : r === 'Moderator'
                    ? 'مشرف (Moderator) — مراجعة وتدقيق الفتاوى'
                    : 'مستخدم عادي (User) — استماع ومطالعة'}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
};
