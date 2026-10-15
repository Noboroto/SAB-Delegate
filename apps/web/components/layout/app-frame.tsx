'use client';

import { Layout } from 'antd';
import Image from 'next/image';
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
          // The three logo colours in equal thirds, as on the link-preview card.
          borderBottom: '3px solid',
          borderImage:
            'linear-gradient(90deg, var(--brand-navy) 0 33.34%, var(--brand-teal) 33.34% 66.67%, var(--brand-yellow) 66.67%) 1',
        }}
      >
        <Link
          href="/servers"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginInlineEnd: 'auto',
          }}
        >
          {/* `unoptimized`: the file is already sized for the slot, so the optimiser would only add a hop. */}
          <Image src="/brand/sab-mark.png" alt="" width={28} height={28} unoptimized />
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
