import { GatewayIntentBits } from 'discord.js';
import type { NecordModuleOptions } from 'necord';
import type { DiscordEnv } from './boot-guard.js';

/**
 * Only what the bot reads. GuildMembers and MessageContent are privileged
 * intents and must be enabled in the Discord developer portal; presences,
 * typing and moderation events are deliberately not requested.
 */
export const DISCORD_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildExpressions,
];

/**
 * `skipRegistration` leaves registering to `CommandRegistrar`, which writes
 * only when the payload changed.
 *
 * `development` must be exactly `false` in production: with a guild list Necord
 * overwrites the `guilds` of every command, so a build meant for the real
 * guilds would register into one test guild instead, and a dev build would
 * register globally if it were left off.
 */
export function buildNecordOptions(
  env: Pick<DiscordEnv, 'APP_ENV' | 'DISCORD_TOKEN' | 'DISCORD_DEV_GUILD_ID'>,
): NecordModuleOptions {
  let development: string[] | false = false;
  if (env.APP_ENV === 'development') {
    if (env.DISCORD_DEV_GUILD_ID === undefined) {
      throw new RangeError('DISCORD_DEV_GUILD_ID is required when APP_ENV is development');
    }
    development = [env.DISCORD_DEV_GUILD_ID];
  }
  return {
    token: env.DISCORD_TOKEN,
    intents: DISCORD_INTENTS,
    // Nothing the bot sends may notify anybody unless that message names who:
    // note text, role names, birthday names and topics are typed by members, and
    // a pasted `@everyone` must stay text. discord.js applies this only to
    // messages that set no `allowedMentions` of their own, so the birthday wish
    // (the celebrant) and replies (the player answered) opt in one by one.
    allowedMentions: { parse: [] },
    skipRegistration: true,
    development,
  };
}
