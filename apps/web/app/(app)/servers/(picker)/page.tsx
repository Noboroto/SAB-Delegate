import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReauthState } from '@/components/auth/reauth-state';
import { ServerList } from '@/components/servers/server-list';
import { ServersEmpty } from '@/components/servers/servers-empty';
import { Heading } from '@/components/ui/heading';
import { getGuildsOrReauth } from '@/lib/guilds';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('servers');
  return { title: t('title') };
}

export default async function ServersPage() {
  const t = await getTranslations('servers');

  const guilds = await getGuildsOrReauth();
  // The server cannot read the guild list with this login: sign in again.
  if (guilds === null) return <ReauthState />;

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      {guilds.length === 0 ? <ServersEmpty /> : <ServerList guilds={guilds} />}
    </>
  );
}
