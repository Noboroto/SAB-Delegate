'use client';

import { useChannels } from '@/lib/discord/use-channels';

/** A channel as `# name` once the list is read; its id until then or when the channel is gone. */
export function ChannelLabel({ guildId, channelId }: { guildId: string; channelId: string }) {
  const channels = useChannels(guildId);
  const name = channels.data?.find((channel) => channel.id === channelId)?.name;

  return <>{name === undefined ? channelId : `# ${name}`}</>;
}
