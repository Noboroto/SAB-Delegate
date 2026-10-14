import { getTranslations } from 'next-intl/server';
import { PageState } from '@/components/ui/page-state';

/** A path under a known server that is not one of its pages: the server navigation stays. */
export default async function GuildPageNotFound() {
  const t = await getTranslations('web.notFoundPage');

  return (
    <PageState
      status="404"
      title={t('title')}
      body={t('body')}
      action={{ label: t('toServers'), href: '/servers' }}
    />
  );
}
