'use client';

import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Segmented } from 'antd';
import { useTranslations } from 'next-intl';
import type { ThemeMode } from '@/lib/theme';
import { useTheme } from './ui/theme-provider';

export function ThemeSwitcher() {
  const t = useTranslations('web.theme');
  const { mode, setMode } = useTheme();

  // Icon-only choices: the label carries the accessible name the radio needs.
  const choice = (value: ThemeMode, icon: React.ReactNode) => ({
    value,
    title: t(value),
    label: (
      <span role="img" aria-label={t(value)}>
        {icon}
      </span>
    ),
  });

  return (
    <Segmented<ThemeMode>
      aria-label={t('label')}
      value={mode}
      onChange={setMode}
      options={[
        choice('light', <SunOutlined />),
        choice('dark', <MoonOutlined />),
        choice('system', <DesktopOutlined />),
      ]}
    />
  );
}
