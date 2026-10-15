import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { GameChannelService } from './game-channel.service.js';
import { LeaderboardService } from './leaderboard.service.js';

/**
 * What the word chain and the channel games share: who plays where, and the
 * points. Kept apart from both so each can import it without a cycle.
 */
@Module({
  imports: [AuditModule, GuildConfigModule],
  providers: [GameChannelService, LeaderboardService],
  exports: [GameChannelService, LeaderboardService],
})
export class GameCoreModule {}
