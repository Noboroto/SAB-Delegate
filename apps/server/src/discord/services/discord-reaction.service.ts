import { Injectable } from '@nestjs/common';
import { Client, type Message, type MessageReaction, type Snowflake, type User } from 'discord.js';

/** Discord returns at most this many users of one reaction per request. */
const REACTORS_PAGE_SIZE = 100;

type MessageLocation = { channelId: string; messageId: string };

type ReactionSummary = {
  /** `emoji.toString()`: the character, or `<:name:id>` for a custom emoji. */
  emoji: string;
  /** Plain name for display; the character itself for a unicode emoji. */
  label: string;
  /** Reactions on the message, bots included. */
  count: number;
};

@Injectable()
export class DiscordReactionService {
  constructor(private readonly client: Client) {}

  /**
   * Ids of the non-bot users who reacted. With `emoji` only that reaction
   * counts (compared as `emoji.toString()`); without it every reaction does.
   * `target` is a message already in hand or a location to fetch it from.
   */
  async fetchReactorIds(target: Message | MessageLocation, emoji?: string): Promise<string[]> {
    const message = await this.messageOf(target);
    const ids = new Set<string>();
    for (const reaction of message.reactions.cache.values()) {
      if (emoji !== undefined && reaction.emoji.toString() !== emoji) continue;
      for (const [id, user] of await this.fetchAllReactors(reaction)) {
        if (!user.bot) ids.add(id);
      }
    }
    return [...ids];
  }

  /** Whether the message carries this reaction. Reads the cache; no API call. */
  hasReaction(message: Message, emoji: string): boolean {
    return message.reactions.cache.some(
      (reaction) => reaction.emoji.toString() === emoji && reaction.count > 0,
    );
  }

  /** The message's reactions with their counts. Reads the cache; no API call. */
  listReactions(message: Message): ReactionSummary[] {
    return [...message.reactions.cache.values()]
      .filter((reaction) => reaction.count > 0)
      .map((reaction) => ({
        emoji: reaction.emoji.toString(),
        label:
          reaction.emoji.id === null
            ? reaction.emoji.toString()
            : `:${reaction.emoji.name ?? 'emoji'}:`,
        count: reaction.count,
      }));
  }

  /** Every user of one reaction, paging with the highest id seen as `after`. */
  private async fetchAllReactors(reaction: MessageReaction): Promise<Map<Snowflake, User>> {
    const users = new Map<Snowflake, User>();
    let after: Snowflake | undefined;
    for (;;) {
      const page = await reaction.users.fetch({ limit: REACTORS_PAGE_SIZE, after });
      if (page.size === 0) break;
      let newest = after;
      for (const [id, user] of page) {
        users.set(id, user);
        if (newest === undefined || BigInt(id) > BigInt(newest)) newest = id;
      }
      // A short page is the last one; an unchanged cursor would loop forever.
      if (page.size < REACTORS_PAGE_SIZE || newest === after) break;
      after = newest;
    }
    return users;
  }

  private async messageOf(target: Message | MessageLocation): Promise<Message> {
    if ('reactions' in target) return target;
    const channel = await this.client.channels.fetch(target.channelId);
    if (!channel?.isTextBased()) {
      throw new RangeError('The channel does not hold messages');
    }
    return channel.messages.fetch(target.messageId);
  }
}
