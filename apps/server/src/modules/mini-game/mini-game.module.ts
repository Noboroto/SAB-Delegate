import { Module } from '@nestjs/common';
import { AppStateModule } from '../../app-state/app-state.service.js';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GameCoreModule } from '../game-core/game-core.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { WordGameModule } from '../word-game/word-game.module.js';
import { CountingService } from './counting.service.js';
import { GameWordsService } from './game-words.service.js';
import { GameCommands, GameInfoCommands } from './mini-game.commands.js';
import { MiniGameListener } from './mini-game.listener.js';
import { MiniGameService } from './mini-game.service.js';
import { ScrambleService } from './scramble.service.js';
import { VietWordsService } from './viet-words.service.js';
import { WordleService } from './wordle.service.js';

/**
 * The channel games (counting, the Vietnamese scramble, Wordle), the leaderboard
 * and the per-game help. Needs the Discord client, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [
    AppStateModule,
    AuditModule,
    I18nModule,
    GuildConfigModule,
    GameCoreModule,
    LlmModule,
    WordGameModule,
  ],
  providers: [
    GameWordsService,
    VietWordsService,
    CountingService,
    ScrambleService,
    WordleService,
    MiniGameService,
    MiniGameListener,
    GameCommands,
    GameInfoCommands,
  ],
})
export class MiniGameModule {}
