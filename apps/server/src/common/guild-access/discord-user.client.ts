import { Injectable } from '@nestjs/common';
import { SnowflakeSchema, z, type Me } from '@sab/shared';
import { LRUCache } from 'lru-cache';
import { Routes } from 'discord.js';
import { createUserRest, type UserGuildsRest } from './user-guilds.client.js';

/** What the account menu shows of the signed-in person; never stored, only held in memory. */
export type DiscordProfile = Pick<Me, 'username' | 'globalName' | 'avatarUrl'>;

export const PROFILE_CACHE_TTL_MS = 10 * 60_000;
const PROFILE_CACHE_MAX = 1000;

const CDN = 'https://cdn.discordapp.com';

const CurrentUserSchema = z.object({
  id: SnowflakeSchema,
  username: z.string(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

/**
 * Discord's own rule for accounts on the new username system: the default
 * picture is chosen by the account id, not by a discriminator.
 */
function avatarUrlOf(id: string, hash: string | null | undefined): string {
  if (hash) {
    // Hashes of animated pictures start with `a_`.
    const extension = hash.startsWith('a_') ? 'gif' : 'png';
    return `${CDN}/avatars/${id}/${hash}.${extension}?size=64`;
  }
  return `${CDN}/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`;
}

/** `GET /users/@me` as the person; a malformed answer throws like any other failure. */
export async function fetchDiscordProfile(rest: UserGuildsRest): Promise<DiscordProfile> {
  const user = CurrentUserSchema.parse(await rest.get(Routes.user('@me')));
  return {
    username: user.username,
    globalName: user.global_name ?? null,
    avatarUrl: avatarUrlOf(user.id, user.avatar),
  };
}

/**
 * The signed-in person's name and picture, read live from Discord and kept in
 * memory for a few minutes so a page load does not call Discord each time. The
 * login deliberately stores neither (see the auth setup), so this is the only
 * place they exist, and only until the entry expires or the process restarts.
 * A failure is not cached: the next request tries again.
 */
@Injectable()
export class DiscordUserClient {
  private readonly profiles = new LRUCache<string, DiscordProfile>({
    max: PROFILE_CACHE_MAX,
    ttl: PROFILE_CACHE_TTL_MS,
    // Without this lru-cache reuses one reading of the clock for a millisecond of real time, which hides a replaced clock.
    ttlResolution: 0,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });

  async profileOf(discordUserId: string, accessToken: string): Promise<DiscordProfile> {
    const cached = this.profiles.get(discordUserId);
    if (cached !== undefined) return cached;
    const profile = await fetchDiscordProfile(createUserRest(accessToken));
    this.profiles.set(discordUserId, profile);
    return profile;
  }
}
