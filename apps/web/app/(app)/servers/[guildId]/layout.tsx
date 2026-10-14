import { notFound } from 'next/navigation';
import { GuildBar } from '@/components/servers/guild-bar';
import { getGuilds } from '@/lib/guilds';

/**
 * One server's dashboard. A server that is not in the visitor's list is the same
 * "not found" as one that does not exist: the list is the server's own answer
 * of what they may manage, and every later call is checked again by its guard.
 */
export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const guilds = await getGuilds();
  if (!guilds.some((guild) => guild.id === guildId)) notFound();

  return (
    <>
      <GuildBar guilds={guilds} currentId={guildId} />
      {children}
    </>
  );
}
