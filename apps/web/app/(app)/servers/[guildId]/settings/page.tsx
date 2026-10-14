import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ReauthState } from '@/components/auth/reauth-state';
import { ServerSettings } from '@/components/settings/server-settings';
import { getGuildsOrReauth } from '@/lib/guilds';
import { getSettingsPageData } from '@/lib/settings/get-settings';

type GuildParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-settings');
  return { title: t('title') };
}

export default async function GuildSettingsPage({ params }: GuildParams) {
  const { guildId } = await params;
  const guilds = await getGuildsOrReauth();
  if (guilds === null) return <ReauthState />;
  // The layout has already turned an unknown server into the 404; this keeps the
  // page from asking the server about an id that is not in the visitor's list.
  const guild = guilds.find((candidate) => candidate.id === guildId);
  if (guild === undefined) notFound();

  const { settings, botProfile } = await getSettingsPageData(guild.id);
  return (
    <ServerSettings
      guildId={guild.id}
      guildName={guild.name}
      settings={settings}
      botProfile={botProfile}
    />
  );
}
