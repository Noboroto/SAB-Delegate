import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SectionStub } from '@/components/layout/section-stub';
import { getGuilds } from '@/lib/guilds';

type GuildParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata({ params }: GuildParams): Promise<Metadata> {
  const { guildId } = await params;
  const guild = (await getGuilds()).find((candidate) => candidate.id === guildId);
  return guild === undefined ? {} : { title: guild.name };
}

export default async function GuildOverviewPage({ params }: GuildParams) {
  const { guildId } = await params;
  const t = await getTranslations('servers.nav');
  const guild = (await getGuilds()).find((candidate) => candidate.id === guildId);
  return <SectionStub title={guild?.name ?? t('overview')} />;
}
