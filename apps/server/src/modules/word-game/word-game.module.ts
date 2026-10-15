import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { DictionaryService } from './dictionary.service.js';
import { WordGameCommands } from './word-game.commands.js';
import { WordGameController } from './word-game.controller.js';
import { WordGameListener } from './word-game.listener.js';
import { WordGameService } from './word-game.service.js';
import { WordDefinitionService } from './word-definition.service.js';

/**
 * Needs the Discord client (messages, channel checks), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, GuildConfigModule, ...restImports()],
  providers: [
    WordGameService,
    DictionaryService,
    WordDefinitionService,
    WordGameListener,
    WordGameCommands,
  ],
  controllers: restControllers([WordGameController]),
  exports: [WordGameService],
})
export class WordGameModule {}
