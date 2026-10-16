import { Inject, Injectable, Logger } from '@nestjs/common';
import { SnowflakeSchema } from '@sab/shared';
import { Client } from 'discord.js';
import { describeFailure } from './chatbot-attachments.js';
import { lookupDisplayNames } from './chatbot-member-names.js';

/**
 * A page of an admin list waits less than a reply does: a slow Discord shows
 * ids for a moment instead of holding the dashboard or an agent.
 */
const NAMES_TIMEOUT_MS = 2_000;

/** Names the members of one page of a list; the database stores ids only. */
@Injectable()
export class ChatbotNamesService {
  private readonly logger = new Logger(ChatbotNamesService.name);

  constructor(@Inject(Client) private readonly client: Client) {}

  /**
   * Display names by member id for `userIds`. A member who left, a lookup that
   * failed or a server the bot is not in gives no entry, which the caller
   * shows as "no name".
   */
  async resolve(guildId: string, userIds: readonly string[]): Promise<Map<string, string>> {
    const id = SnowflakeSchema.safeParse(guildId);
    const guild = id.success ? this.client.guilds.cache.get(id.data) : undefined;
    if (guild === undefined || userIds.length === 0) return new Map();
    return lookupDisplayNames(
      guild.members,
      new Set(userIds),
      (error) => {
        this.logger.warn(`Member lookup failed (${describeFailure(error)})`);
      },
      NAMES_TIMEOUT_MS,
    );
  }
}
