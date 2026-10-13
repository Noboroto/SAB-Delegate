import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { AddPollCommands } from './add-poll.commands.js';
import { MessagingCommands } from './messaging.commands.js';
import { MessagingContextMenus } from './messaging.context-menus.js';
import { MessagingModals } from './messaging.modals.js';
import { MessagingService } from './messaging.service.js';

/**
 * Needs the Discord client for the commands, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule],
  providers: [
    MessagingService,
    MessagingCommands,
    AddPollCommands,
    MessagingContextMenus,
    MessagingModals,
    ReactionAutocompleteInterceptor,
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
