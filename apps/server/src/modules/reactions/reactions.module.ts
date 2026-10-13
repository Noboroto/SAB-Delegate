import { Module } from '@nestjs/common';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { AutoReactListener } from './auto-react.listener.js';
import { ReactionDictionary } from './reaction-dictionary.js';

/**
 * Needs the Discord client for its listener, so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`. The
 * language lookup is for the exception filter every listener carries.
 */
@Module({
  imports: [I18nModule],
  providers: [ReactionDictionary, AutoReactListener],
})
export class ReactionsModule {}
