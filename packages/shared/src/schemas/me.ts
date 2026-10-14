import { z } from 'zod';
import { SnowflakeSchema } from './snowflake.js';

/** The signed-in person as the cookie proves it: only the Discord account, nothing is stored about them. */
export const MeSchema = z.object({ discordUserId: SnowflakeSchema });

/**
 * One entry of the server picker: a server the bot is in where the person may
 * manage it. `icon` is Discord's icon hash (null when the server has none);
 * the web app builds the CDN address from it.
 */
export const GuildPickerItemSchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  icon: z.string().nullable(),
});

export type Me = z.infer<typeof MeSchema>;
export type GuildPickerItem = z.infer<typeof GuildPickerItemSchema>;
