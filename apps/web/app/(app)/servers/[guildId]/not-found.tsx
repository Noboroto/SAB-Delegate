import { getTranslations } from 'next-intl/server';
import { PageState } from '@/components/ui/page-state';

/** Unknown server, no bot in it and no permission look the same on purpose. */
export default async function GuildNotFound() {
  const t = await getTranslations('servers.notFound');

  return (
    <PageState
      status="404"
      title={t('title')}
      body={t('body')}
      action={{ label: t('back'), href: '/servers' }}
    />
  );
}
