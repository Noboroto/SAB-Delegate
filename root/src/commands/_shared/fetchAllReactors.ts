import { Message, MessageReaction, Snowflake, User } from "discord.js";

const PAGE_SIZE = 100;

/** Every user of one reaction; the API returns at most 100 per request. */
export const fetchAllReactors = async (
  reaction: MessageReaction
): Promise<Map<Snowflake, User>> => {
  const users = new Map<Snowflake, User>();
  let after: Snowflake | undefined;

  for (;;) {
    const page = await reaction.users.fetch({ limit: PAGE_SIZE, after });
    if (page.size === 0) break;
    let newest = after;
    for (const [id, user] of page) {
      users.set(id, user);
      if (newest === undefined || BigInt(id) > BigInt(newest)) newest = id;
    }
    if (page.size < PAGE_SIZE || newest === after) break;
    after = newest;
  }
  return users;
};

/**
 * Ids of the non-bot users who reacted to `message`. With `emoji` only that
 * reaction counts; without it every reaction does.
 */
export const fetchReactorIds = async (
  message: Message,
  emoji?: string
): Promise<string[]> => {
  const ids = new Set<string>();
  for (const reaction of message.reactions.cache.values()) {
    if (emoji !== undefined && reaction.emoji.toString() !== emoji) continue;
    for (const [id, user] of await fetchAllReactors(reaction)) {
      if (!user.bot) ids.add(id);
    }
  }
  return [...ids];
};

/** Whether `message` carries a reaction with this emoji (cheap, no API call). */
export const hasReaction = (message: Message, emoji: string): boolean =>
  message.reactions.cache.some(
    (reaction) => reaction.emoji.toString() === emoji && reaction.count > 0
  );
