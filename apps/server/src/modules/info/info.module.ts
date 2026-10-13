import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { InfoCommands } from './info.commands.js';
import { InfoService } from './info.service.js';

/**
 * Needs the Discord client to read channels, members and reactions, so it is
 * left out of the application while a migration is pending; see
 * `feature-modules.ts`. The interceptor suggests the emoji already on a message
 * for `/get id-by-reaction`.
 */
@Module({
  imports: [AuditModule, I18nModule, GuildConfigModule],
  providers: [InfoService, InfoCommands, ReactionAutocompleteInterceptor],
  exports: [InfoService],
})
export class InfoModule {}
