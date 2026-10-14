import { getTranslations } from 'next-intl/server';
import { PageState } from '@/components/ui/page-state';

export default async function NotFound() {
  const t = await getTranslations('web.notFoundPage');
  return (
    <main id="main" className="page-main">
      <PageState
        status="404"
        title={t('title')}
        body={t('body')}
        action={{ label: t('toServers'), href: '/servers' }}
      />
    </main>
  );
}
