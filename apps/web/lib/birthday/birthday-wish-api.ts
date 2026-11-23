import {
  BirthdayWishViewSchema,
  z,
  type BirthdayWishInput,
  type BirthdayWishView,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

const wishesPath = (guildId: string, ...rest: string[]) =>
  guildApiPath(guildId, 'birthday-wishes', ...rest);

export function addBirthdayWish(
  guildId: string,
  wish: BirthdayWishInput,
): Promise<BirthdayWishView> {
  return apiFetch(wishesPath(guildId), {
    method: 'POST',
    body: wish,
    parser: BirthdayWishViewSchema,
  });
}

export function updateBirthdayWish(
  guildId: string,
  id: string,
  wish: BirthdayWishInput,
): Promise<BirthdayWishView> {
  return apiFetch(wishesPath(guildId, id), {
    method: 'PATCH',
    body: wish,
    parser: BirthdayWishViewSchema,
  });
}

/** The server answers 204 with no body, which the client parses as `null`. */
export function removeBirthdayWish(guildId: string, id: string): Promise<null> {
  return apiFetch(wishesPath(guildId, id), { method: 'DELETE', parser: z.null() });
}
