import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { DictionaryService } from './dictionary.service.js';
import { WordGameCommands } from './word-game.commands.js';
import { WordGameListener } from './word-game.listener.js';
import { WordGameService } from './word-game.service.js';

/**
 * Needs the Discord client (messages, channel checks), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, GuildConfigModule],
  providers: [WordGameService, DictionaryService, WordGameListener, WordGameCommands],
  exports: [WordGameService],
})
export class WordGameModule {}
