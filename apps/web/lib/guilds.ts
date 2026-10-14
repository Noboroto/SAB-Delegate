import { cache } from 'react';
import { GuildPickerItemSchema, z } from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';

/**
 * The servers the visitor may manage where the bot is. `cache` shares one
 * answer between the layout, the page and the metadata of the same render: the
 * server asks Discord for this list and rate-limits it tightly, so it must be
 * fetched once per request, not once per component.
 */
export const getGuilds = cache(() =>
  serverFetch('/api/guilds', { parser: z.array(GuildPickerItemSchema) }),
);
