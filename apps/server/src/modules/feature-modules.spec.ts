import { describe, expect, it } from 'vitest';
import { GuildAccessModule } from '../common/guild-access/guild-access.module.js';
import { BirthdayModule } from './birthday/birthday.module.js';
import { DISCORD_FEATURE_MODULES, featureModules } from './feature-modules.js';
import { GuildConfigModule } from './guild-config/guild-config.module.js';
import { NoteModule } from './note/note.module.js';
import { ReactionsModule } from './reactions/reactions.module.js';
import { SystemModule } from './system/system.module.js';

describe('featureModules', () => {
  it('lists every module that needs the Discord client', () => {
    expect(DISCORD_FEATURE_MODULES).toEqual([
      GuildConfigModule,
      SystemModule,
      GuildAccessModule,
      BirthdayModule,
      NoteModule,
      ReactionsModule,
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
