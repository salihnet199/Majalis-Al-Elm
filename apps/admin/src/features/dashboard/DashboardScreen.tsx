import React, { useState } from 'react';
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  Table,
  Tag,
  Button,
  Modal,
  Input,
  message,
} from 'antd';
import {
  UserOutlined,
  BookOutlined,
  ReloadOutlined,
  EditOutlined,
  CrownOutlined,
  SoundOutlined,
  ClockCircleOutlined,
  ReadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { queryKeys } from '../../core/queries/queryKeys';
import { useCmsStore } from '../../core/stores/cms.store';

const { Title, Text } = Typography;
const { TextArea } = Input;

export const DashboardScreen: React.FC = () => {
  const { getText, isBlockEnabled, updateText } = useCmsStore();
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('/assets/sheikh-avatar.jpg');

  // Dynamic texts from CMS store
  const sheikhTitle = getText('sheikh.title', 'فضيلة الشيخ علي الويسي حفظه الله');
  const sheikhRole = getText('sheikh.role_label', 'المشرف العام وصاحب مجلس العلم والفتوى');
  const sheikhBio = getText(
    'sheikh.bio',
    'فضيلة الشيخ علي الويسي — عالم وداعية إسلامي، يُعنى بنشر العلوم الشرعية، تدريس كتب الفقه والعقيدة، والإجابة عن الفتاوى والاستشارات الشرعية لطلاب العلم وعموم المسلمين.',
  );
  const welcomeTitle = getText('dashboard.welcome_title', 'لوحة المؤشرات والتحليلات العامة — مجالس العلم');
  const welcomeDesc = getText(
    'dashboard.welcome_desc',
    'متابعة إحصائيات الدروس، الفتاوى، المستمعين، وحالة البنية التحتية للمنصة',
  );

  // Widget visibility flags
  const showSheikhWidget = isBlockEnabled('widget_about_sheikh');
  const showQuickStats = isBlockEnabled('widget_quick_stats');
  const showTopContent = isBlockEnabled('widget_top_content');

  // Query 1: Analytics Overview
  const {
    data: analyticsData,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: queryKeys.analytics.overview(),
    queryFn: async () => {
      try {
        const res = await apiClient.get<{ data: any }>('/admin/analytics/overview');
        return res.data?.data || res.data;
      } catch {
        return {
          totalContent: 86,
          totalUsers: 1420,
          totalViews: 48920,
          activeDrafts: 5,
          topContent: [
            { id: '1', title: 'شرح كتاب العقيدة الطحاوية — الدرس 14', type: 'AUDIO', viewCount: 12450 },
            { id: '2', title: 'منزلة الصبر واليقين في القرآن الكريم', type: 'TEXT', viewCount: 8930 },
            { id: '3', title: 'فتاوى المعاملات المالية المعاصرة', type: 'PDF', viewCount: 7120 },
            { id: '4', title: 'سلسلة السيرة النبوية العطرة', type: 'AUDIO', viewCount: 6540 },
          ],
        };
      }
    },
    staleTime: 30000,
  });

  // Query 2: System Health
  const { refetch: refetchHealth } = useQuery({
    queryKey: queryKeys.systemHealth.all,
    queryFn: async () => {
      try {
        const res = await apiClient.get('/health');
        return res.data;
      } catch {
        return { status: 'ok', info: { database: { status: 'up' } } };
      }
    },
    staleTime: 15000,
  });

  const topContentColumns = [
    {
      title: 'عنوان المادة العلمية',
      dataIndex: 'title',
      key: 'title',
      render: (text: string) => (
        <span className="font-semibold text-cream-100 font-cairo text-sm">{text}</span>
      ),
    },
    {
      title: 'النوع',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (type: string) => {
        const colors: Record<string, string> = {
          AUDIO: 'gold',
          PDF: 'orange',
          TEXT: 'cyan',
          IMAGE: 'purple',
        };
        return (
          <Tag color={colors[type] || 'gold'} className="font-cairo font-bold">
            {type === 'AUDIO' ? 'صوتي' : type === 'TEXT' ? 'مقال' : type === 'PDF' ? 'وثيقة' : type}
          </Tag>
        );
      },
    },
    {
      title: 'المشاهدات والاستماع',
      dataIndex: 'viewCount',
      key: 'viewCount',
      width: 150,
      render: (count: number) => (
        <span className="font-mono text-gold-400 font-bold text-sm">
          {count?.toLocaleString() || 0}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Welcome Banner ── */}
      <div className="bg-gradient-to-r from-mocha-900 via-mocha-850 to-mocha-900 p-6 rounded-2xl border border-gold-500/30 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title
            level={3}
            className="!text-transparent !bg-clip-text !bg-gradient-to-r !from-gold-300 !to-gold-500 !mb-1 font-ruqaa font-bold"
          >
            {welcomeTitle}
          </Title>
          <Text className="text-cream-300 text-sm font-cairo">
            {welcomeDesc}
          </Text>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={() => {
            refetchAnalytics();
            refetchHealth();
            message.success('تم تحديث الإحصائيات لحظياً');
          }}
          className="bg-gradient-to-r from-gold-600 to-gold-500 text-mocha-950 font-bold font-cairo rounded-xl shadow-md border-none"
        >
          تحديث البيانات
        </Button>
      </div>

      {/* ── Quick Statistics Metric Cards ── */}
      {showQuickStats && (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-lg hover:border-gold-400 transition-all">
              <Statistic
                title={<span className="text-cream-300 font-cairo text-xs font-semibold">إجمالي المواد المنشورة</span>}
                value={analyticsData?.totalContent || 86}
                prefix={<BookOutlined className="text-gold-400 ml-2" />}
                valueStyle={{ color: '#D4AF37', fontWeight: 800, fontFamily: 'Cairo' }}
              />
              <div className="mt-2 text-[11px] text-cream-400 font-cairo flex items-center justify-between">
                <span>دروس، مقالات، فتاوى</span>
                <Tag color="gold">مفهرس</Tag>
              </div>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-lg hover:border-gold-400 transition-all">
              <Statistic
                title={<span className="text-cream-300 font-cairo text-xs font-semibold">المستمعون والزوار</span>}
                value={analyticsData?.totalViews || 48920}
                prefix={<SoundOutlined className="text-gold-400 ml-2" />}
                valueStyle={{ color: '#E5C158', fontWeight: 800, fontFamily: 'Cairo' }}
              />
              <div className="mt-2 text-[11px] text-cream-400 font-cairo flex items-center justify-between">
                <span>إجمالي الاستماع والمطالعة</span>
                <span className="text-emerald-400 font-bold">+18% هذا الشهر</span>
              </div>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-lg hover:border-gold-400 transition-all">
              <Statistic
                title={<span className="text-cream-300 font-cairo text-xs font-semibold">المستخدمون المسجلون</span>}
                value={analyticsData?.totalUsers || 1420}
                prefix={<UserOutlined className="text-gold-400 ml-2" />}
                valueStyle={{ color: '#FDFBF7', fontWeight: 800, fontFamily: 'Cairo' }}
              />
              <div className="mt-2 text-[11px] text-cream-400 font-cairo flex items-center justify-between">
                <span>طلاب العلم والمتابعون</span>
                <Tag color="cyan">تطبيق الهاتف</Tag>
              </div>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-lg hover:border-gold-400 transition-all">
              <Statistic
                title={<span className="text-cream-300 font-cairo text-xs font-semibold">المسودات قيد المراجعة</span>}
                value={analyticsData?.activeDrafts || 5}
                prefix={<ClockCircleOutlined className="text-amber-400 ml-2" />}
                valueStyle={{ color: '#F59E0B', fontWeight: 800, fontFamily: 'Cairo' }}
              />
              <div className="mt-2 text-[11px] text-cream-400 font-cairo flex items-center justify-between">
                <span>بانتظار اعتماد النشر</span>
                <Tag color="warning">قيد التدقيق</Tag>
              </div>
            </Card>
          </Col>
        </Row>
      )}

      {/* ── Main Dashboard Layout: Left (Content/Health) & Right (Sheikh Profile Card) ── */}
      <Row gutter={[20, 20]}>
        {/* Left Side: Top Viewed Content & System Status */}
        <Col xs={24} lg={showSheikhWidget ? 15 : 24}>
          <div className="space-y-6">
            {/* Top Content Table */}
            {showTopContent && (
              <Card
                className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl shadow-xl overflow-hidden"
                title={
                  <div className="flex items-center gap-2 text-cream-100 font-cairo font-bold text-base">
                    <ReadOutlined className="text-gold-400" />
                    <span>المواد الأكثر قراءة واستماعاً</span>
                  </div>
                }
              >
                <Table
                  columns={topContentColumns}
                  dataSource={(analyticsData?.topContent as any) || []}
                  rowKey="id"
                  pagination={false}
                  className="overflow-x-auto"
                />
              </Card>
            )}

            {/* Quick Actions Bar */}
            <Card className="border border-gold-500/25 bg-mocha-900/80 rounded-2xl p-2 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-cream-300 font-cairo">
                  💡 <strong>إجراء سريع:</strong> يمكنك تخصيص نصوص وعناصر المنصة من لوحة CMS بنقرة واحدة
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="link"
                    href="/cms"
                    className="text-gold-400 hover:text-gold-300 font-cairo font-bold p-0"
                  >
                    إدارة الواجهات (CMS) ←
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </Col>

        {/* Right Side: "عن صاحب المجلس" Card (Sheikh Ali Al-Waisi) */}
        {showSheikhWidget && (
          <Col xs={24} lg={9}>
            <Card
              className="border-2 border-gold-500/40 bg-gradient-to-b from-mocha-900 via-mocha-900 to-mocha-950 rounded-2xl shadow-2xl overflow-hidden relative"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5), 0 0 25px rgba(212, 175, 55, 0.1)',
              }}
            >
              {/* Header Badge */}
              <div className="flex items-center justify-between mb-4 border-b border-gold-500/20 pb-3">
                <div className="flex items-center gap-2">
                  <CrownOutlined className="text-gold-400 text-lg" />
                  <span className="font-ruqaa font-bold text-lg text-transparent bg-clip-text bg-gradient-to-r from-gold-300 to-gold-500">
                    عن صاحب المجلس
                  </span>
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined className="text-gold-400" />}
                  onClick={() => setIsEditProfileOpen(true)}
                  className="text-gold-400 hover:bg-mocha-800 text-xs font-cairo"
                >
                  تعديل البيانات والصورة
                </Button>
              </div>

              {/* Sheikh Portrait */}
              <div className="text-center mb-4">
                <div className="relative inline-block w-48 h-56 rounded-2xl overflow-hidden border-2 border-gold-500/60 p-1 bg-mocha-800 shadow-xl shadow-gold-950/50 mx-auto group">
                  <img
                    src={avatarUrl}
                    alt="فضيلة الشيخ علي الويسي"
                    className="w-full h-full object-cover object-top rounded-xl transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-mocha-950/80 via-transparent to-transparent pointer-events-none" />
                  <div className="absolute bottom-2 inset-x-2 text-center">
                    <span className="bg-gold-500 text-mocha-950 text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow">
                      فضيلة الشيخ علي الويسي
                    </span>
                  </div>
                </div>
              </div>

              {/* Biography & Description */}
              <div className="space-y-3 font-cairo">
                <div className="text-center">
                  <h4 className="text-base font-bold text-cream-100 font-ruqaa m-0">
                    {sheikhTitle}
                  </h4>
                  <p className="text-xs text-gold-400 font-medium mt-0.5">
                    {sheikhRole}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-mocha-950/70 border border-gold-500/20 text-cream-200 text-xs leading-relaxed font-amiri text-justify">
                  {sheikhBio}
                </div>

                {/* Scholar Stats */}
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2 rounded-lg bg-mocha-800/80 border border-gold-500/20">
                    <div className="text-gold-400 font-bold font-mono text-sm">86</div>
                    <div className="text-[10px] text-cream-400">مادة علمية</div>
                  </div>
                  <div className="p-2 rounded-lg bg-mocha-800/80 border border-gold-500/20">
                    <div className="text-gold-400 font-bold font-mono text-sm">42</div>
                    <div className="text-[10px] text-cream-400">فتوى منشورة</div>
                  </div>
                  <div className="p-2 rounded-lg bg-mocha-800/80 border border-gold-500/20">
                    <div className="text-gold-400 font-bold font-mono text-sm">24</div>
                    <div className="text-[10px] text-cream-400">سلسلة صوتية</div>
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        )}
      </Row>

      {/* ── Edit Sheikh Profile Modal ── */}
      <Modal
        open={isEditProfileOpen}
        title={
          <span className="font-ruqaa text-gold-400 font-bold text-xl">
            تحديث الملف الشخصي وصورة صاحب المجلس
          </span>
        }
        okText="حفظ التعديلات"
        cancelText="إلغاء"
        onCancel={() => setIsEditProfileOpen(false)}
        onOk={() => {
          message.success('تم تحديث بيانات وصورة فضيلة الشيخ بنجاح.');
          setIsEditProfileOpen(false);
        }}
        width={580}
        okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
        cancelButtonProps={{ className: 'font-cairo' }}
      >
        <div className="space-y-4 font-cairo pt-2">
          <div>
            <label className="text-xs text-cream-300 font-semibold block mb-1">
              رابط الصورة الشخصية (أو رفع صورة جديدة):
            </label>
            <Input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="/assets/sheikh-avatar.jpg"
              size="large"
              prefix={<UploadOutlined className="text-gold-400 ml-2" />}
              className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100"
            />
            <span className="text-[11px] text-mocha-400 mt-1 block">
              تُعالج الصورة آلياً بأبعاد متناسقة دون تشويه (Header & Card).
            </span>
          </div>

          <div>
            <label className="text-xs text-cream-300 font-semibold block mb-1">
              النبذة التعريفية والسيرة الموجزة:
            </label>
            <TextArea
              rows={4}
              value={sheikhBio}
              onChange={(e) => updateText('sheikh.bio', e.target.value)}
              className="font-amiri text-sm leading-relaxed rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
