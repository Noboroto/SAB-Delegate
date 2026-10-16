import { describe, expect, it } from 'vitest';
import { GuildAccessModule } from '../common/guild-access/guild-access.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { ApiKeyModule } from './api-key/api-key.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { BirthdayModule } from './birthday/birthday.module.js';
import { ChatbotModule } from './chatbot/chatbot.module.js';
import { DISCORD_FEATURE_MODULES, featureModules } from './feature-modules.js';
import { GuildConfigModule } from './guild-config/guild-config.module.js';
import { InfoModule } from './info/info.module.js';
import { MentionModule } from './mention/mention.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { NoteModule } from './note/note.module.js';
import { PurgeModule } from './purge/purge.module.js';
import { ReactionsModule } from './reactions/reactions.module.js';
import { RoleAssignModule } from './role-assign/role-assign.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { SystemModule } from './system/system.module.js';
import { ThreadModule } from './thread/thread.module.js';
import { WordGameModule } from './word-game/word-game.module.js';
import { MiniGameModule } from './mini-game/mini-game.module.js';

describe('featureModules', () => {
  it('lists every module that needs the Discord client', () => {
    expect(DISCORD_FEATURE_MODULES).toEqual([
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
    ]);
    expect(featureModules({})).toEqual(DISCORD_FEATURE_MODULES);
    expect(featureModules({ MIGRATION_PENDING: '' })).toEqual(DISCORD_FEATURE_MODULES);
    expect(featureModules({ MIGRATION_PENDING: 'false' })).toEqual(DISCORD_FEATURE_MODULES);
  });

  it('returns none while a migration is pending', () => {
    expect(featureModules({ MIGRATION_PENDING: 'true' })).toEqual([]);
    expect(featureModules({ MIGRATION_PENDING: ' true ' })).toEqual([]);
  });
});
