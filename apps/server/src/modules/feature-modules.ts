import type { Type } from '@nestjs/common';
import { migrationPendingFromEnv } from '../discord/discord.module.js';
import { GuildAccessModule } from '../common/guild-access/guild-access.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { ApiKeyModule } from './api-key/api-key.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { BirthdayModule } from './birthday/birthday.module.js';
import { ChatbotModule } from './chatbot/chatbot.module.js';
import { EmailVerifyModule } from './email-verify/email-verify.module.js';
import { GuildConfigModule } from './guild-config/guild-config.module.js';
import { InfoModule } from './info/info.module.js';
import { MentionModule } from './mention/mention.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { MiniGameModule } from './mini-game/mini-game.module.js';
import { NoteModule } from './note/note.module.js';
import { PurgeModule } from './purge/purge.module.js';
import { ReactionsModule } from './reactions/reactions.module.js';
import { RoleAssignModule } from './role-assign/role-assign.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { SystemModule } from './system/system.module.js';
import { ThreadModule } from './thread/thread.module.js';
import { WordGameModule } from './word-game/word-game.module.js';

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
  BirthdayModule,
  NoteModule,
  ReactionsModule,
  WordGameModule,
  MiniGameModule,
  ScheduleModule,
  MessagingModule,
  MentionModule,
  RoleAssignModule,
  ThreadModule,
  PurgeModule,
  ActivityModule,
  AttendanceModule,
  InfoModule,
  ApiKeyModule,
  ChatbotModule,
  EmailVerifyModule,
];

/** Reads the raw environment like `DiscordModule.forRoot`: Nest builds the module graph before anything is parsed. */
export function featureModules(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly Type[] {
  return migrationPendingFromEnv(env) ? [] : DISCORD_FEATURE_MODULES;
}
