'use client';

import { LookupChannelSchema, z, type LookupChannel } from '@sab/shared';
import { useLookup, type LookupState } from './use-lookup';
import { guildApiPath } from '@/lib/guild-path';

const ChannelsSchema = z.array(LookupChannelSchema);

/** Discord's channel type numbers the pickers filter on. */
export const CHANNEL_TYPE = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
} as const;

/** The channels a person can post a message in. */
export const TEXT_CHANNEL_TYPES: readonly number[] = [CHANNEL_TYPE.text, CHANNEL_TYPE.announcement];

/** The channels of a server, in the order Discord shows them. */
export function useChannels(guildId: string): LookupState<LookupChannel[]> {
  return useLookup(guildApiPath(guildId, 'discord', 'channels'), ChannelsSchema);
}
