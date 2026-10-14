import { cache } from 'react';
import { GuildPickerItemSchema, z, type GuildPickerItem } from '@sab/shared';
import { ApiRequestError } from '@/lib/api/api-response';
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

/**
 * Like `getGuilds`, but `null` when the login no longer carries what the list
 * needs (the Discord token): the page then offers a new sign-in instead of an
 * error. Every other failure still reaches the error boundary.
 */
export async function getGuildsOrReauth(): Promise<GuildPickerItem[] | null> {
  try {
    return await getGuilds();
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === 'AUTH_REAUTH_REQUIRED') return null;
    throw error;
  }
}
