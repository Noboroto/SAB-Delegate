import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { MentionCommands } from './mention.commands.js';
import { MentionContextMenus } from './mention.context-menus.js';
import { MentionController } from './mention.controller.js';
import { MentionResponder } from './mention.responder.js';
import { MentionService } from './mention.service.js';
import { ThreadEveryoneCommands } from './thread-everyone.commands.js';

/**
 * Needs the Discord client for the commands, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, ...restImports()],
  providers: [
    MentionService,
    MentionResponder,
    MentionCommands,
    ThreadEveryoneCommands,
    MentionContextMenus,
    ReactionAutocompleteInterceptor,
  ],
  controllers: restControllers([MentionController]),
  exports: [MentionService],
})
export class MentionModule {}
