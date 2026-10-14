import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { NoteTopicAutocompleteInterceptor } from './note-topic.autocomplete.js';
import { NoteCommands } from './note.commands.js';
import { NoteController } from './note.controller.js';
import { NoteService } from './note.service.js';

/**
 * Needs the Discord client for the commands, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, GuildConfigModule, ...restImports()],
  providers: [NoteService, NoteCommands, NoteTopicAutocompleteInterceptor],
  controllers: restControllers([NoteController]),
  exports: [NoteService],
})
export class NoteModule {}
