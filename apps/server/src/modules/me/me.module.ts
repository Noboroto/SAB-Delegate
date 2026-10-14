import { Module, type Type } from '@nestjs/common';
import { AuthModule, restEnabledFromEnv } from '../../auth/auth.module.js';
import { GuildAccessModule } from '../../common/guild-access/guild-access.module.js';
import { migrationPendingFromEnv } from '../../discord/discord.module.js';
import { MeController } from './me.controller.js';

@Module({ imports: [AuthModule, GuildAccessModule], controllers: [MeController] })
export class MeModule {}

/**
 * The caller-scoped routes exist when the REST API is on and the bot is
 * logged in: the server list needs the Discord client, which a pending
 * migration leaves out.
 */
export function meModules(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Type[] {
  return restEnabledFromEnv(env) && !migrationPendingFromEnv(env) ? [MeModule] : [];
}
