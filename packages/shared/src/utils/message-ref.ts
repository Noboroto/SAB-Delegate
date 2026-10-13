import { z } from 'zod';
import { SnowflakeSchema } from '../schemas/snowflake.js';

export const MessageRefFailureSchema = z.enum(['EMPTY', 'MALFORMED', 'CHANNEL_REQUIRED']);

export type MessageRefFailure = z.infer<typeof MessageRefFailureSchema>;

export const MessageRefResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** Absent for a bare id, a `channel/message` pair and a DM link. */
    guildId: SnowflakeSchema.optional(),
    channelId: SnowflakeSchema,
    messageId: SnowflakeSchema,
  }),
  z.object({ ok: z.literal(false), reason: MessageRefFailureSchema }),
]);

export type MessageRefResult = z.infer<typeof MessageRefResultSchema>;

const ID = String.raw`\d{17,20}`;

// Discord's own host variants. `@me` is a direct-message channel. A trailing
// query or fragment (copied from some clients) is ignored.
const LINK = new RegExp(
  String.raw`^(?:https?://)?(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com/channels/(@me|${ID})/(${ID})/(${ID})/?(?:[?#].*)?$`,
  'i',
);
const CHANNEL_AND_MESSAGE = new RegExp(String.raw`^(${ID})\s*[/-]\s*(${ID})$`);
const BARE_ID = new RegExp(String.raw`^${ID}$`);

/**
 * Reads a message reference a person typed or pasted: a "Copy Message Link"
 * URL (also wrapped in `<>` as Discord does when embeds are suppressed, or
 * with a trailing slash), a `channelId/messageId` pair, or a bare message id
 * that is resolved in `defaults.channelId`. Never throws; the failure carries
 * the reason so the caller can say what was wrong instead of "not found".
 */
export function parseMessageRef(
  input: string,
  defaults: { channelId?: string } = {},
): MessageRefResult {
  const text = input
    .trim()
    .replace(/^<(.*)>$/s, '$1')
    .trim();
  if (text === '') return { ok: false, reason: 'EMPTY' };

  const [, guild, linkChannel, linkMessage] = LINK.exec(text) ?? [];
  if (linkChannel !== undefined && linkMessage !== undefined) {
    return {
      ok: true,
      ...(guild !== undefined && guild !== '@me' ? { guildId: guild } : {}),
      channelId: linkChannel,
      messageId: linkMessage,
    };
  }

  const [, pairChannel, pairMessage] = CHANNEL_AND_MESSAGE.exec(text) ?? [];
  if (pairChannel !== undefined && pairMessage !== undefined) {
    return { ok: true, channelId: pairChannel, messageId: pairMessage };
  }

  if (BARE_ID.test(text)) {
    if (defaults.channelId === undefined) return { ok: false, reason: 'CHANNEL_REQUIRED' };
    return { ok: true, channelId: defaults.channelId, messageId: text };
  }
  return { ok: false, reason: 'MALFORMED' };
}
