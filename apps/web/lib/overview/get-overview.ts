import { SystemOverviewSchema, type SystemOverview } from '@sab/shared';
import { ApiRequestError } from '@/lib/api/api-response';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';

export type OverviewResult = { ok: true; overview: SystemOverview } | { ok: false };

/**
 * The bot's health for one server. A bot that is down or still starting
 * (`503`, `GUILD_BOT_MISSING`, a timeout) is an answer the page can show beside
 * the server's name, so it comes back as `{ ok: false }`; sign-in and
 * "not found" keep their redirect and 404 (they are not `ApiRequestError`s
 * here), and a malformed answer still reaches the error boundary.
 * `guildId` must already be known to be one of the visitor's servers.
 */
export async function getOverview(guildId: string): Promise<OverviewResult> {
  try {
    const overview = await serverFetch(guildApiPath(guildId, 'overview'), {
      parser: SystemOverviewSchema,
    });
    return { ok: true, overview };
  } catch (error) {
    if (error instanceof ApiRequestError) return { ok: false };
    throw error;
  }
}
