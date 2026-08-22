import { ThemeConfig, theme } from 'antd';
import { THEME_COLORS } from './theme.constants';

export const getThemeConfig = (mode: 'dark' | 'light'): ThemeConfig => {
  const isDark = mode === 'dark';

  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: THEME_COLORS.goldPrimary,
      colorSuccess: THEME_COLORS.success,
      colorWarning: THEME_COLORS.warning,
      colorError: THEME_COLORS.error,
      colorInfo: THEME_COLORS.goldHover,
      borderRadius: 10,
      fontFamily: 'Cairo, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      colorBgBase: isDark ? THEME_COLORS.bgBase : '#FAF8F5',
      colorBgContainer: isDark ? THEME_COLORS.bgContainer : '#FFFFFF',
      colorBgElevated: isDark ? THEME_COLORS.bgElevated : '#F5EFE6',
      colorBorder: isDark ? THEME_COLORS.borderGold : '#E8DEC8',
      colorTextBase: isDark ? THEME_COLORS.textPrimary : '#2B1E17',
    },
    components: {
      Layout: {
        bodyBg: isDark ? THEME_COLORS.bgBase : '#FAF8F5',
        headerBg: isDark ? THEME_COLORS.bgContainer : '#FFFFFF',
        siderBg: isDark ? THEME_COLORS.bgContainer : '#FFFFFF',
      },
      Menu: {
        darkItemBg: THEME_COLORS.bgContainer,
        darkItemSelectedBg: 'rgba(212, 175, 55, 0.18)',
        darkItemSelectedColor: THEME_COLORS.goldPrimary,
        itemBorderRadius: 8,
      },
      Table: {
        headerBg: isDark ? THEME_COLORS.bgElevated : '#F5EFE6',
        headerColor: isDark ? THEME_COLORS.textSecondary : '#4A342A',
        rowHoverBg: isDark ? 'rgba(212, 175, 55, 0.08)' : '#FDFBF7',
      },
      Card: {
        headerBg: 'transparent',
      },
      Button: {
        primaryShadow: '0 4px 14px 0 rgba(212, 175, 55, 0.35)',
      },
    },
  };
};
