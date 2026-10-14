import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReauthState } from '@/components/auth/reauth-state';
import { ServerList } from '@/components/servers/server-list';
import { PageState } from '@/components/ui/page-state';
import { Heading } from '@/components/ui/heading';
import { ApiRequestError } from '@/lib/api/api-response';
import { getGuilds } from '@/lib/guilds';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('servers');
  return { title: t('title') };
}

export default async function ServersPage() {
  const t = await getTranslations('servers');

  let guilds;
  try {
    guilds = await getGuilds();
  } catch (error) {
    // The server cannot read the guild list with this login: sign in again.
    if (error instanceof ApiRequestError && error.code === 'AUTH_REAUTH_REQUIRED') {
      return <ReauthState />;
    }
    throw error;
  }

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      {guilds.length === 0 ? (
        <PageState status="info" title={t('empty.title')} body={t('empty.body')} />
      ) : (
        <ServerList guilds={guilds} />
      )}
    </>
  );
}
