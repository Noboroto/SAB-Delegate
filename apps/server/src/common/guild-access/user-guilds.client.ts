import { Injectable } from '@nestjs/common';
import { ErrorCode, SnowflakeSchema, canManageGuild, z, type GuildPickerItem } from '@sab/shared';
import { DiscordAPIError, REST, Routes } from 'discord.js';
import { ServiceError } from '../errors/service-error.js';

/** A server from the person's OAuth list, before the bot's presence is known. */
export type ManageableGuild = Pick<GuildPickerItem, 'id' | 'name' | 'icon'>;

/** Discord returns at most this many entries per page of `GET /users/@me/guilds`. */
const PAGE_SIZE = 200;
/** A person in more servers than this sees the first ones only; the cap bounds the REST calls one request can make. */
const MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/** The fields of a server in the OAuth server list that the picker uses; the rest is dropped. */
const OAuthGuildSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean(),
  permissions: z.string(),
});

const OAuthGuildPageSchema = z.array(OAuthGuildSchema);

/** The only REST call the client makes; replaced by a stub in tests. */
export type UserGuildsRest = Pick<REST, 'get'>;

/**
 * Every server the person is in that they may manage, from the OAuth server
 * list. Pages are followed up to `MAX_PAGES`. A rejected token (revoked or
 * expired) is a request to sign in again; a rate limit or any other upstream
 * failure is a Discord error, never an empty list.
 */
export async function fetchManageableGuilds(rest: UserGuildsRest): Promise<ManageableGuild[]> {
  const manageable: ManageableGuild[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (after !== undefined) query.set('after', after);

    let raw: unknown;
    try {
      raw = await rest.get(Routes.userGuilds(), { query });
    } catch (error) {
      throw translateFailure(error);
    }
    const parsed = OAuthGuildPageSchema.safeParse(raw);
    if (!parsed.success) throw new ServiceError(ErrorCode.DISCORD_API_ERROR);

    for (const guild of parsed.data) {
      if (canManageGuild({ permissions: guild.permissions, isOwner: guild.owner })) {
        manageable.push({ id: guild.id, name: guild.name, icon: guild.icon });
      }
    }
    const last = parsed.data.at(-1);
    if (parsed.data.length < PAGE_SIZE || last === undefined) break;
    after = last.id;
  }
  return manageable;
}

function translateFailure(error: unknown): unknown {
  if (error instanceof DiscordAPIError && error.status === 401) {
    return new ServiceError(ErrorCode.AUTH_REAUTH_REQUIRED);
  }
  // Anything else (429, 5xx, network) keeps its class: the HTTP filter maps it.
  return error;
}

/**
 * Calls Discord as the person, with the access token from their login cookie.
 * Each call gets its own REST instance: the library's rate-limit state is per
 * instance, and one person's 429 must not reject another person's request.
 * It rejects on a rate limit instead of sleeping, so a request never waits on
 * Discord's `retry-after`.
 */
@Injectable()
export class UserGuildsClient {
  manageableGuilds(accessToken: string): Promise<ManageableGuild[]> {
    const rest = new REST({
      authPrefix: 'Bearer',
      version: '10',
      timeout: REQUEST_TIMEOUT_MS,
      retries: 1,
      rejectOnRateLimit: () => true,
      // No background sweepers: they would outlive a one-call instance.
      hashSweepInterval: 0,
      handlerSweepInterval: 0,
    }).setToken(accessToken);
    return fetchManageableGuilds(rest);
  }
}
