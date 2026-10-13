import type { Type } from '@nestjs/common';
import { migrationPendingFromEnv } from '../discord/discord.module.js';
import { GuildAccessModule } from '../common/guild-access/guild-access.module.js';
import { GuildConfigModule } from './guild-config/guild-config.module.js';
import { SystemModule } from './system/system.module.js';

/**
 * Every module that needs the Discord client or its command registry. With
 * `MIGRATION_PENDING=true` no client exists (see `DiscordModule.forRoot`), so
 * these are left out of the application instead of failing to resolve it.
 * `AuditModule` is not listed: it only needs the database and is imported by
 * the modules that record audit rows.
 */
export const DISCORD_FEATURE_MODULES: readonly Type[] = [
  GuildConfigModule,
  SystemModule,
  GuildAccessModule,
];

/** Reads the raw environment like `DiscordModule.forRoot`: Nest builds the module graph before anything is parsed. */
export function featureModules(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Type[] {
  return migrationPendingFromEnv(env) ? [] : DISCORD_FEATURE_MODULES;
}
