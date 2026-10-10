import { Client, TextChannel } from "discord.js";

// Guild whose #bot-log channel receives runtime errors from every bot instance.
const ADMIN_GUILD_ID = "713025650176294945";
const LOG_CHANNEL_NAME = "bot-log";
// Discord rejects messages over 2000 chars; leave room for the code fence.
const MAX_DETAIL_LENGTH = 1900;

const describeError = (error: unknown) =>
  error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
    : JSON.stringify(error, null, 2);

/**
 * Logs an error to the console and, when this client is in the admin guild,
 * to its #bot-log channel. Never throws: a failing report must not take down
 * the handler that is reporting.
 */
export const reportError = async (
  client: Client,
  title: string,
  error: unknown
) => {
  console.error(title);
  console.error(error);

  try {
    const channel = client.guilds.cache
      .get(ADMIN_GUILD_ID)
      ?.channels.cache.find((channel) => channel.name === LOG_CHANNEL_NAME) as
      TextChannel | undefined;
    if (!channel) return;

    await channel.send({ content: title.slice(0, 2000) });
    await channel.send({
      content:
        "```\n" + describeError(error).slice(0, MAX_DETAIL_LENGTH) + "\n```",
    });
  } catch (reportFailure) {
    console.error("Failed to report error to bot-log", reportFailure);
  }
};

/**
 * Claims a key for the whole process. Every bot client receives the same
 * gateway events, so work that must happen once per message/guild/day (word
 * game, birthday wishes) claims a key first and skips when another client did.
 */
const claimed = new Map<string, number>();
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

/** Gives a claim back so another client can retry work that failed. */
export const releaseClaim = (key: string) => {
  claimed.delete(key);
};

export const claimOnce = (key: string): boolean => {
  const now = Date.now();
  // Map keeps insertion order, so expired claims are always at the front.
  for (const [oldKey, at] of claimed) {
    if (now - at <= CLAIM_TTL_MS) break;
    claimed.delete(oldKey);
  }
  if (claimed.has(key)) return false;
  claimed.set(key, now);
  return true;
};
