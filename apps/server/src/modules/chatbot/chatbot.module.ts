import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { GuildConfigModule } from '../guild-config/guild-config.module.js';
import { PgBossModule } from '../../jobs/pg-boss.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotHistoryCron } from './chatbot-history.cron.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';

/**
 * Per-server chatbot: where it answers, the quota default and the model behind
 * it. Needs the Discord client (channel checks), so it is left out of the
 * application while a migration is pending; see `feature-modules.ts`.
 */
@Module({
  imports: [AuditModule, GuildConfigModule, LlmModule, PgBossModule],
  providers: [ChatbotConfigService, ChatbotQuotaService, ChatbotHistoryService, ChatbotHistoryCron],
  exports: [ChatbotConfigService, ChatbotQuotaService, ChatbotHistoryService],
})
export class ChatbotModule {}
