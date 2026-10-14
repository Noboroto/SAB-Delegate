import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { RoleAssignCommands } from './role-assign.commands.js';
import { RoleAssignController } from './role-assign.controller.js';
import { RoleAssignService } from './role-assign.service.js';

/**
 * Needs the Discord client for the commands, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, I18nModule, ...restImports()],
  providers: [RoleAssignService, RoleAssignCommands, ReactionAutocompleteInterceptor],
  controllers: restControllers([RoleAssignController]),
  exports: [RoleAssignService],
})
export class RoleAssignModule {}
