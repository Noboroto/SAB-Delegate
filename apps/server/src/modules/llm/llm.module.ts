import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module.js';
import { restControllers, restImports } from '../../common/rest/rest-wiring.js';
import { loadEnv } from '../../config/env.js';
import { ChatbotPauseService } from './chatbot-pause.service.js';
import { LlmController } from './llm.controller.js';
import { LlmChatService } from './llm-chat.service.js';
import { LLM_ENV, LlmService } from './llm.service.js';

@Module({
  imports: [AuditModule, ...restImports()],
  providers: [
    LlmService,
    LlmChatService,
    ChatbotPauseService,
    {
      provide: LLM_ENV,
      useFactory: () => {
        const env = loadEnv();
        return { secret: env.LLM_KEY_SECRET, adminGuildId: env.ADMIN_GUILD_ID };
      },
    },
  ],
  controllers: restControllers([LlmController]),
  exports: [LlmService, LlmChatService, ChatbotPauseService],
})
export class LlmModule {}
