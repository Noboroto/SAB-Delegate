import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { RoleAssignCommands } from './role-assign.commands.js';
import { RoleAssignService } from './role-assign.service.js';

/**
 * Needs the Discord client for the commands, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule],
  providers: [RoleAssignService, RoleAssignCommands, ReactionAutocompleteInterceptor],
  exports: [RoleAssignService],
})
export class RoleAssignModule {}
