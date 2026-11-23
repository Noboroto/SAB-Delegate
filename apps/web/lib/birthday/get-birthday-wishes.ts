import { BirthdayWishViewSchema, z } from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';

const WishesSchema = z.array(BirthdayWishViewSchema);

/** The server's wishes, oldest first; the first read fills a new server with the built-in ones. */
export function getBirthdayWishes(guildId: string) {
  return serverFetch(guildApiPath(guildId, 'birthday-wishes'), { parser: WishesSchema });
}
