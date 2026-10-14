import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReauthState } from '@/components/auth/reauth-state';
import { ServerOverview } from '@/components/overview/server-overview';
import { getGuildsOrReauth } from '@/lib/guilds';
import { getOverview } from '@/lib/overview/get-overview';

type GuildParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata({ params }: GuildParams): Promise<Metadata> {
  const { guildId } = await params;
  const guild = (await getGuildsOrReauth())?.find((candidate) => candidate.id === guildId);
  return guild === undefined ? {} : { title: guild.name };
}

export default async function GuildOverviewPage({ params }: GuildParams) {
  const { guildId } = await params;
  const guilds = await getGuildsOrReauth();
  if (guilds === null) return <ReauthState />;
  // The layout has already turned an unknown server into the 404; this keeps the
  // page from asking the server about an id that is not in the visitor's list.
  const guild = guilds.find((candidate) => candidate.id === guildId);
  if (guild === undefined) notFound();

  const result = await getOverview(guild.id);
  return (
    <ServerOverview
      guildId={guild.id}
      guildName={guild.name}
      overview={result.ok ? result.overview : undefined}
    />
  );
}
