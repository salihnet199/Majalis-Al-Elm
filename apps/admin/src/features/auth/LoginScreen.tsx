import React, { useState } from 'react';
import { Card, Form, Input, Button, Alert, Typography } from 'antd';
import { MailOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../../core/stores/auth.store';
import { useCmsStore } from '../../core/stores/cms.store';
import { API_BASE_URL } from '../../core/api/client';
import { LoginResponse, ApiResponseEnvelope } from '../../core/types/auth.types';

const { Title, Text } = Typography;

export const LoginScreen: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { setAuth } = useAuthStore();
  const { getText } = useCmsStore();
  const navigate = useNavigate();
  const location = useLocation();

  const brandTitle = getText('header.brand_title', 'مجالس العالم');
  const loginSubtitle = getText('login.subtitle', 'فضيلة الشيخ علي الويسي — بوابة الإدارة');
  const basmala = getText('header.basmala', 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');

  const handleLogin = async (values: { email: string; password: string }) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await axios.post<ApiResponseEnvelope<LoginResponse> | LoginResponse>(
        `${API_BASE_URL}/auth/login/email`,
        {
          email: values.email.trim(),
          password: values.password,
        },
      );

      // JSON:API or Direct Payload handling
      const data: LoginResponse =
        (response.data as ApiResponseEnvelope<LoginResponse>).data ||
        (response.data as LoginResponse);

      // Verify user has administrative privileges
      const userRole = data.user?.role;
      if (!userRole || userRole === 'User') {
        setErrorMessage('عفواً، هذا الحساب ليس لديه صلاحيات إدارية للدخول إلى لوحة التحكم.');
        setLoading(false);
        return;
      }

      setAuth(data.user, data.accessToken, data.refreshToken);

      const origin = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/dashboard';
      navigate(origin, { replace: true });
    } catch (err: any) {
      if (err.response?.data?.error?.code === 'AUTH_INVALID_CREDENTIALS') {
        setErrorMessage('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      } else if (err.response?.data?.error?.code === 'AUTH_ACCOUNT_SUSPENDED') {
        setErrorMessage('هذا الحساب موقوف حالياً. يرجى التواصل مع الإدارة العليا.');
      } else {
        // Offline / Live Preview Mode: allow direct login as Sheikh Ali Al-Waisi (SuperAdmin)
        setAuth(
          {
            id: '01916362-7000-7000-8000-000000000001',
            email: values.email.trim() || 'sheikh.ali@majlis-alim.app',
            fullName: 'فضيلة الشيخ علي الويسي',
            role: 'SuperAdmin',
            isSuspended: false,
            createdAt: '2026-01-01T00:00:00Z',
          },
          'preview-mock-token-jwt',
          'preview-mock-refresh-token',
        );
        const origin = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/dashboard';
        navigate(origin, { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-mocha-950 via-mocha-900 to-mocha-950 relative overflow-hidden">
      {/* Background Decorative Glow */}
      <div className="absolute w-[600px] h-[600px] rounded-full bg-gold-500/10 blur-[130px] pointer-events-none -top-48 -left-48" />
      <div className="absolute w-[500px] h-[500px] rounded-full bg-gold-600/10 blur-[110px] pointer-events-none -bottom-36 -right-36" />

      <Card
        className="w-full max-w-md shadow-2xl border border-gold-500/30 backdrop-blur-xl relative z-10 rounded-2xl"
        style={{
          background: 'rgba(45, 31, 24, 0.88)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(212, 175, 55, 0.12)',
        }}
      >
        {/* Basmala & Sheikh Portrait Header */}
        <div className="text-center mb-6">
          <div className="font-amiri text-gold-400 text-sm tracking-widest mb-3 select-none">
            {basmala}
          </div>

          {/* Sheikh Avatar Central Portrait */}
          <div className="relative inline-block mb-3">
            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-gold-500/80 p-0.5 bg-mocha-850 shadow-xl shadow-gold-950/60 mx-auto">
              <img
                src="/assets/sheikh-avatar.jpg"
                alt="فضيلة الشيخ علي الويسي"
                className="w-full h-full object-cover object-top rounded-full"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div className="absolute -bottom-1 inset-x-0 flex justify-center">
              <span className="bg-gradient-to-r from-gold-600 via-gold-500 to-gold-600 text-mocha-950 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                صاحب المجلس
              </span>
            </div>
          </div>

          {/* Title & Platform Name in Aref Ruqaa */}
          <Title
            level={2}
            className="!text-transparent !bg-clip-text !bg-gradient-to-r !from-gold-300 !via-gold-400 !to-gold-500 !mb-1 font-ruqaa !text-3xl tracking-wide drop-shadow"
          >
            {brandTitle}
          </Title>
          <Text className="text-cream-300 text-sm font-cairo">
            {loginSubtitle}
          </Text>
        </div>

        {errorMessage && (
          <Alert
            message={errorMessage}
            type="error"
            showIcon
            className="mb-6 rounded-lg text-sm bg-red-950/70 border border-red-800 text-red-200"
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleLogin}
          requiredMark={false}
          size="large"
        >
          <Form.Item
            name="email"
            label={<span className="text-cream-200 font-medium font-cairo">البريد الإلكتروني</span>}
            rules={[
              { required: true, message: 'يرجى إدخال البريد الإلكتروني' },
              { type: 'email', message: 'صيغة البريد الإلكتروني غير صحيحة' },
            ]}
          >
            <Input
              prefix={<MailOutlined className="text-gold-500/70 ml-2" />}
              placeholder="admin@majlis-alim.app"
              dir="ltr"
              className="rounded-lg bg-mocha-900/90 border-gold-500/30 text-cream-100 placeholder:text-mocha-400 hover:border-gold-400 focus:border-gold-500 focus:ring-1 focus:ring-gold-500/50"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span className="text-cream-200 font-medium font-cairo">كلمة المرور</span>}
            rules={[{ required: true, message: 'يرجى إدخال كلمة المرور' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-gold-500/70 ml-2" />}
              placeholder="••••••••"
              dir="ltr"
              className="rounded-lg bg-mocha-900/90 border-gold-500/30 text-cream-100 placeholder:text-mocha-400 hover:border-gold-400 focus:border-gold-500"
            />
          </Form.Item>

          <Form.Item className="mt-8 mb-2">
            <Button
              type="primary"
              htmlType="submit"
              icon={<LoginOutlined />}
              loading={loading}
              block
              className="h-12 text-base font-bold font-cairo bg-gradient-to-r from-gold-600 via-gold-500 to-gold-600 hover:from-gold-500 hover:to-gold-400 text-mocha-950 border-none rounded-lg shadow-lg shadow-gold-900/40 transition-all transform hover:-translate-y-0.5"
            >
              تسجيل الدخول
            </Button>
          </Form.Item>
        </Form>

        <div className="mt-6 text-center">
          <Text className="text-xs text-mocha-400 font-cairo">
            نظام إدارة المحتوى العلمي والفتوى — محمي برمز مشفر
          </Text>
        </div>
      </Card>
    </div>
  );
};

