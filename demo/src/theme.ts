import type { ThemeConfig } from 'antd'

const theme: ThemeConfig = {
  token: {
    // Brand colors
    colorPrimary: '#6366f1',
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorInfo: '#6366f1',

    // Typography
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,

    // Border & radius
    borderRadius: 8,
    borderRadiusLG: 14,
    borderRadiusSM: 6,

    // Shadows
    boxShadow: '0 1px 3px rgba(99, 102, 241, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 4px 16px rgba(99, 102, 241, 0.10), 0 2px 6px rgba(0, 0, 0, 0.06)',

    // Layout
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f5f4fc',
    colorBorder: '#ede9fe',
    colorBorderSecondary: '#e5e7eb',

    // Text
    colorText: '#1e1b4b',
    colorTextSecondary: '#6b7280',
    colorTextTertiary: '#9ca3af',
  },
  components: {
    Button: {
      borderRadius: 50,
      controlHeight: 40,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 14,
    },
    Tag: {
      borderRadiusSM: 50,
    },
    Layout: {
      headerBg: '#ffffff',
      footerBg: '#f9fafb',
      bodyBg: '#f5f4fc',
    },
  },
}

export default theme
