'use client';

import { Layout } from 'antd';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { UserMenu } from '@/components/auth/user-menu';
import { LangSwitcher } from '@/components/lang-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';

/** Header (brand, language, theme, account) and the content area every signed-in page sits in. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const t = useTranslations('web');

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link
          href="/servers"
          style={{ fontWeight: 600, color: 'var(--text-primary)', marginInlineEnd: 'auto' }}
        >
          {t('appName')}
        </Link>
        <LangSwitcher />
        <ThemeSwitcher />
        <UserMenu />
      </Layout.Header>
      {/* Not `Layout.Content`: it renders its own `<main>`, and a page may have only one. */}
      <main id="main" className="page-main" style={{ flex: 'auto', minHeight: 0 }}>
        {children}
      </main>
    </Layout>
  );
}
