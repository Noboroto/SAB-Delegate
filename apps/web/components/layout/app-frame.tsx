'use client';

import { Grid, Layout } from 'antd';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Me } from '@sab/shared';
import { SessionKeepAlive } from '@/components/auth/session-keep-alive';
import { UserMenu } from '@/components/auth/user-menu';
import { UnsavedGuardProvider } from '@/components/forms/unsaved-guard';
import { LangSwitcher } from '@/components/lang-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';

/** Header (brand, language, theme, account) and the content area every signed-in page sits in. */
export function AppFrame({ account, children }: { account: Me; children: React.ReactNode }) {
  const t = useTranslations('web');
  // Unmeasured counts as wide: a phone briefly shows the name, a desktop never loses it.
  const compact = Grid.useBreakpoint().md === false;

  return (
    <UnsavedGuardProvider>
      <SessionKeepAlive />
      <Layout style={{ minHeight: '100dvh' }}>
        <Layout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            // Same side margin as the page below, so the brand lines up with the content.
            paddingInline: 'var(--page-px)',
            // The three logo colours in equal thirds, as on the link-preview card.
            borderBottom: '3px solid',
            borderImage:
              'linear-gradient(90deg, var(--brand-navy) 0 33.34%, var(--brand-teal) 33.34% 66.67%, var(--brand-yellow) 66.67%) 1',
          }}
        >
          <Link
            href="/servers"
            aria-label={compact ? t('appName') : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginInlineEnd: 'auto',
            }}
          >
            {/* `unoptimized`: the file is already sized for the slot, so the optimiser would only add a hop. */}
            <Image src="/brand/sab-mark.png" alt="" width={28} height={28} unoptimized />
            {compact ? null : t('appName')}
          </Link>
          <LangSwitcher />
          <ThemeSwitcher />
          <UserMenu account={account} />
        </Layout.Header>
        {/* Not `Layout.Content`: it renders its own `<main>`, and a page may have only one. */}
        <main id="main" className="page-main" style={{ flex: 'auto', minHeight: 0 }}>
          {children}
        </main>
      </Layout>
    </UnsavedGuardProvider>
  );
}
