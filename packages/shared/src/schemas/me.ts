import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/** The signed-in person as the cookie proves it: only the Discord account, nothing is stored about them. */
export const MeSchema = z.object({ discordUserId: SnowflakeSchema });

/** What the web app needs to build the "add the bot" link of one server. */
export const BotInviteSchema = z.object({
  clientId: SnowflakeSchema,
  /** The permissions value of the invite link, a decimal string. */
  permissions: z.string().regex(/^\d{1,20}$/),
});

/**
 * One entry of the server picker: a server the person may manage. `icon` is
 * Discord's icon hash (null when the server has none); the web app builds the
 * CDN address from it. `botPresent: false` marks a server the bot is not in yet;
 * it carries `invite` and has no dashboard. Lists without the field (older
 * servers, API keys) read as bot present.
 */
export const GuildPickerItemSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  icon: z.string().nullable(),
  botPresent: z.boolean().default(true),
  invite: BotInviteSchema.nullable().default(null),
});

export type Me = z.infer<typeof MeSchema>;
export type BotInvite = z.infer<typeof BotInviteSchema>;
export type GuildPickerItem = z.infer<typeof GuildPickerItemSchema>;
