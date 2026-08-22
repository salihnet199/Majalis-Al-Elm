import React from 'react';
import { Layout, Button, Dropdown, Tag } from 'antd';
import {
  DashboardOutlined,
  BookOutlined,
  AppstoreOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  BellOutlined,
  SettingOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  DownOutlined,
  PlusCircleOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '../core/stores/auth.store';
import { useUiStore } from '../core/stores/ui.store';
import { useCmsStore } from '../core/stores/cms.store';

const { Header, Content } = Layout;

export const AdminLayout: React.FC = () => {
  const { user, role, logout } = useAuthStore();
  const { theme: themeMode, toggleTheme } = useUiStore();
  const { getText } = useCmsStore();
  const navigate = useNavigate();
  const location = useLocation();

  const brandTitle = getText('header.brand_title', 'مجالس العلم');
  const sheikhSubtitle = getText('header.sheikh_subtitle', 'فضيلة الشيخ علي الويسي حفظه الله');
  const basmala = getText('header.basmala', 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userMenu = {
    items: [
      {
        key: 'user-info',
        label: (
          <div className="p-3 border-b border-gold-500/20 bg-mocha-900 rounded-t-lg">
            <div className="font-bold text-cream-100 font-cairo">{user?.fullName || 'فضيلة الشيخ علي الويسي'}</div>
            <div className="text-xs text-cream-300 font-mono">{user?.email}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Tag color="gold" className="font-cairo font-semibold border-gold-500/40 bg-gold-500/10 text-gold-400">
                {role === 'SuperAdmin' ? 'المدير العام' : role === 'Admin' ? 'مدير نظام' : role}
              </Tag>
            </div>
          </div>
        ),
      },
      {
        key: 'cms-settings',
        icon: <SettingOutlined className="text-gold-400" />,
        label: <span className="font-cairo text-cream-100">إدارة الواجهات (CMS)</span>,
        onClick: () => navigate('/cms'),
      },
      {
        key: 'logout',
        icon: <LogoutOutlined className="text-red-400" />,
        label: <span className="text-red-400 font-cairo">تسجيل الخروج</span>,
        onClick: handleLogout,
      },
    ],
  };

  const contentSubMenu = {
    items: [
      {
        key: 'all-content',
        icon: <UnorderedListOutlined className="text-gold-400" />,
        label: <span className="font-cairo text-cream-100">جميع المواد المنشورة</span>,
        onClick: () => navigate('/content'),
      },
      {
        key: 'categories-mgmt',
        icon: <AppstoreOutlined className="text-gold-400" />,
        label: <span className="font-cairo text-cream-100">إدارة الأقسام والتصنيفات</span>,
        onClick: () => navigate('/categories'),
      },
      {
        key: 'add-content',
        icon: <PlusCircleOutlined className="text-gold-400" />,
        label: <span className="font-cairo text-gold-400 font-bold">نشر مادة جديدة</span>,
        onClick: () => navigate('/content?action=new'),
      },
    ],
  };

  return (
    <Layout
      className="min-h-screen font-cairo transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* ── 1. Top Regal Header & Calligraphy Banner ── */}
      <div
        className="border-b px-4 sm:px-8 py-3 relative overflow-hidden transition-colors duration-200"
        style={{
          background: 'linear-gradient(to bottom, var(--header-from), var(--header-to))',
          borderColor: 'var(--border-gold)',
        }}
      >
        {/* Subtle Decorative Gold Glows */}
        <div className="absolute top-0 right-1/4 w-96 h-24 bg-gold-500/10 blur-3xl pointer-events-none" />
        <div className="absolute top-0 left-1/4 w-96 h-24 bg-gold-500/10 blur-3xl pointer-events-none" />

        {/* Basmala Header Ornament */}
        <div className="text-center font-amiri text-gold-500 text-sm sm:text-base tracking-widest mb-1 select-none font-bold">
          {basmala}
        </div>

        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Left: Sheikh Avatar Profile Corner */}
          <div className="flex items-center gap-3">
            <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
              <div
                className="flex items-center gap-2.5 cursor-pointer p-1.5 pr-2.5 pl-2 rounded-xl border transition-all shadow-md"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-gold)',
                }}
              >
                <div className="relative w-10 h-10 rounded-full overflow-hidden border border-gold-400 bg-mocha-900 flex-shrink-0 shadow-inner">
                  <img
                    src="/assets/sheikh-avatar.jpg"
                    alt="فضيلة الشيخ علي الويسي"
                    className="w-full h-full object-cover object-top"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
                <div className="hidden md:flex flex-col text-right">
                  <span className="text-xs font-bold font-cairo" style={{ color: 'var(--text-primary)' }}>
                    فضيلة الشيخ علي الويسي
                  </span>
                  <span className="text-[10px] text-gold-500 font-bold">لوحة الإدارة والمجلس</span>
                </div>
                <DownOutlined className="text-xs text-gold-500 mr-1" />
              </div>
            </Dropdown>

            {/* Theme Toggle Button */}
            <Button
              type="text"
              shape="circle"
              icon={themeMode === 'dark' ? <SunOutlined className="text-gold-400 text-lg" /> : <MoonOutlined className="text-mocha-700 text-lg" />}
              onClick={toggleTheme}
              className="border shadow-sm transition-all"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-gold)',
              }}
              title={themeMode === 'dark' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
            />
          </div>

          {/* Center: Grand Emblem in Aref Ruqaa */}
          <div className="text-center cursor-pointer" onClick={() => navigate('/dashboard')}>
            <h1 className="text-2xl sm:text-3xl font-ruqaa font-bold text-transparent bg-clip-text bg-gradient-to-r from-gold-500 via-amber-600 to-gold-500 dark:from-gold-300 dark:via-gold-400 dark:to-gold-500 m-0 tracking-wide drop-shadow">
              {brandTitle}
            </h1>
            <p className="text-[11px] sm:text-xs font-cairo m-0 tracking-wider font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {sheikhSubtitle}
            </p>
          </div>

          {/* Right: Quick Action / Status */}
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={() => navigate('/cms')}
              className="px-3 py-1.5 rounded-full border text-[11px] font-bold flex items-center gap-1.5 shadow-sm transition-all text-gold-600 dark:text-gold-300"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-gold)',
              }}
            >
              <SettingOutlined className="text-gold-500" />
              <span>إدارة الواجهات CMS</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Top Navigation Bar with Dropdowns ── */}
      <Header
        className="h-13 px-4 sm:px-8 flex items-center justify-center sticky top-0 z-30 shadow-xl border-b backdrop-blur-md transition-colors duration-200"
        style={{
          background: 'var(--nav-bg)',
          borderColor: 'var(--border-gold)',
        }}
      >
        <div className="max-w-7xl w-full flex items-center justify-center">
          <nav className="flex items-center gap-1 sm:gap-3 overflow-x-auto py-1 scrollbar-none">
            {/* 1. Dashboard */}
            <button
              onClick={() => navigate('/dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                location.pathname === '/dashboard' || location.pathname === '/'
                  ? 'bg-gold-500 text-mocha-950 font-bold shadow-md shadow-gold-900/30'
                  : 'hover:text-gold-500 hover:bg-gold-500/10'
              }`}
              style={{
                color: location.pathname === '/dashboard' || location.pathname === '/' ? '#1a120d' : 'var(--text-primary)',
              }}
            >
              <DashboardOutlined />
              <span>لوحة المؤشرات</span>
            </button>

            {/* 2. Content Dropdown */}
            <Dropdown menu={contentSubMenu} placement="bottom" trigger={['hover', 'click']}>
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  location.pathname.startsWith('/content')
                    ? 'bg-gold-500/20 text-gold-500 border font-bold'
                    : 'hover:text-gold-500 hover:bg-gold-500/10'
                }`}
                style={{
                  color: location.pathname.startsWith('/content') ? '#d4af37' : 'var(--text-primary)',
                  borderColor: 'var(--border-gold)',
                }}
              >
                <BookOutlined />
                <span>إدارة المحتوى</span>
                <DownOutlined className="text-[10px]" />
              </button>
            </Dropdown>

            {/* 3. Categories Management */}
            <button
              onClick={() => navigate('/categories')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                location.pathname === '/categories'
                  ? 'bg-gold-500 text-mocha-950 font-bold shadow-md shadow-gold-900/30'
                  : 'hover:text-gold-500 hover:bg-gold-500/10'
              }`}
              style={{
                color: location.pathname === '/categories' ? '#1a120d' : 'var(--text-primary)',
              }}
            >
              <AppstoreOutlined />
              <span>الأقسام والتصنيفات</span>
            </button>

            {/* 4. Users */}
            <button
              onClick={() => navigate('/users')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                location.pathname === '/users'
                  ? 'bg-gold-500 text-mocha-950 font-bold shadow-md shadow-gold-900/30'
                  : 'hover:text-gold-500 hover:bg-gold-500/10'
              }`}
              style={{
                color: location.pathname === '/users' ? '#1a120d' : 'var(--text-primary)',
              }}
            >
              <UserOutlined />
              <span>المستخدمين</span>
            </button>

            {/* 5. CMS Settings */}
            <button
              onClick={() => navigate('/cms')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                location.pathname === '/cms'
                  ? 'bg-gold-500 text-mocha-950 font-bold shadow-md shadow-gold-900/30'
                  : 'hover:text-gold-500 hover:bg-gold-500/10'
              }`}
              style={{
                color: location.pathname === '/cms' ? '#1a120d' : 'var(--text-primary)',
              }}
            >
              <SettingOutlined />
              <span>إدارة الواجهات (CMS)</span>
            </button>

            {/* 6. Audit Logs */}
            <button
              onClick={() => navigate('/audit-logs')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                location.pathname === '/audit-logs'
                  ? 'bg-gold-500 text-mocha-950 font-bold shadow-md shadow-gold-900/30'
                  : 'hover:text-gold-500 hover:bg-gold-500/10'
              }`}
              style={{
                color: location.pathname === '/audit-logs' ? '#1a120d' : 'var(--text-primary)',
              }}
            >
              <SafetyCertificateOutlined />
              <span>سجل التدقيق</span>
            </button>

            {/* 7. Announcements */}
            <button
              onClick={() => navigate('/announcements')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                location.pathname === '/announcements'
                  ? 'bg-gold-500 text-mocha-950 font-bold shadow-md shadow-gold-900/30'
                  : 'hover:text-gold-500 hover:bg-gold-500/10'
              }`}
              style={{
                color: location.pathname === '/announcements' ? '#1a120d' : 'var(--text-primary)',
              }}
            >
              <BellOutlined />
              <span>الإعلانات</span>
            </button>
          </nav>
        </div>
      </Header>

      {/* ── 3. Main Body Content Area ── */}
      <Content className="p-4 sm:p-6 max-w-7xl w-full mx-auto overflow-y-auto">
        <Outlet />
      </Content>
    </Layout>
  );
};
