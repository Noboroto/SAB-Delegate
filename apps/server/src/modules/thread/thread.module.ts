import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { PrivateThreadCommands } from './private-thread.commands.js';
import { PrivateThreadService } from './private-thread.service.js';
import { ThreadCommands } from './thread.commands.js';
import { ThreadController } from './thread.controller.js';
import { ThreadService } from './thread.service.js';

/**
 * Needs the Discord client (channels, threads, messages), so it is left out of
 * the application while a migration is pending; see `feature-modules.ts`.
 * `MessageResolver` and `DiscordReactionService` come from the global
 * `DiscordModule`.
 */
@Module({
  imports: [AuditModule, I18nModule, ...restImports()],
  providers: [ThreadService, PrivateThreadService, ThreadCommands, PrivateThreadCommands],
  controllers: restControllers([ThreadController]),
  exports: [ThreadService, PrivateThreadService],
})
export class ThreadModule {}
