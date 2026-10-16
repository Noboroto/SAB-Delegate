import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { I18nModule } from '../../i18n/guild-locale.service.js';
import { PgBossModule } from '../../jobs/pg-boss.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotContextService } from './chatbot-context.service.js';
import { ChatbotHistoryCron } from './chatbot-history.cron.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotListener } from './chatbot.listener.js';
import { ChatbotService } from './chatbot.service.js';

/**
 * Per-server chatbot: where it answers, the quota default and the model behind
 * it, and the listener that answers a mention. Needs the Discord client, so it
 * is left out of the application while a migration is pending; see
 * `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, GuildConfigModule, I18nModule, LlmModule, PgBossModule],
  providers: [
    ChatbotConfigService,
    ChatbotQuotaService,
    ChatbotHistoryService,
    ChatbotHistoryCron,
    ChatbotContextService,
    ChatbotMemoryService,
    ChatbotService,
    ChatbotListener,
  ],
  exports: [
    ChatbotConfigService,
    ChatbotQuotaService,
    ChatbotHistoryService,
    ChatbotContextService,
    ChatbotMemoryService,
  ],
})
export class ChatbotModule {}
