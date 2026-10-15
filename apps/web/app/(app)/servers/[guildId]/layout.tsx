import { notFound } from 'next/navigation';
import { ReauthState } from '@/components/auth/reauth-state';
import { GuildBar } from '@/components/servers/guild-bar';
import { getGuildsOrReauth } from '@/lib/guilds';

/**
 * One server's dashboard. A server that is not in the visitor's list, or that the bot is not in, is the same
 * "not found" as one that does not exist: the list is the server's own answer
 * of what they may manage, and every later call is checked again by its guard.
 *
 * `notFound()` from a layout is caught by the `not-found.tsx` of a parent
 * segment (`servers/`), never by one next to this file.
 */
export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const guilds = await getGuildsOrReauth();
  if (guilds === null) return <ReauthState />;
  // The picker also lists servers the bot is not in; they have no dashboard.
  const withBot = guilds.filter((guild) => guild.botPresent);
  if (!withBot.some((guild) => guild.id === guildId)) notFound();

  return (
    <>
      <GuildBar guilds={withBot} currentId={guildId} />
      {children}
    </>
  );
}
