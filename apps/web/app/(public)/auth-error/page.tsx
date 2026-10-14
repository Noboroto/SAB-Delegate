import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageState } from '@/components/ui/page-state';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('login.errorPage');
  return { title: t('title') };
}

/** Where Better Auth sends a failed or cancelled sign-in (`onAPIError.errorURL` on the server). */
export default async function AuthErrorPage() {
  const t = await getTranslations('login.errorPage');

  return (
    <main id="main" className="page-main">
      <PageState
        status="error"
        title={t('title')}
        body={t('body')}
        action={{ label: t('retry'), href: '/login' }}
      />
    </main>
  );
}
