import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GameCoreModule } from '../game-core/game-core.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { DictionaryService } from './dictionary.service.js';
import { WordGameController } from './word-game.controller.js';
import { WordGameListener } from './word-game.listener.js';
import { WordGameService } from './word-game.service.js';
import { WordDefinitionService } from './word-definition.service.js';

/**
 * Needs the Discord client (messages, channel checks), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, GuildConfigModule, GameCoreModule, ...restImports()],
  providers: [WordGameService, DictionaryService, WordDefinitionService, WordGameListener],
  controllers: restControllers([WordGameController]),
  // The channel games check English words against the same list.
  exports: [WordGameService, DictionaryService],
})
export class WordGameModule {}
