import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CHATBOT_HISTORY_RETENTION_DAYS, QUEUES } from '@sab/shared';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { PgBossService } from '../../jobs/pg-boss.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';

/** 03:15 every day, read in the business time zone by `PgBossService.schedule`. */
export const CHATBOT_HISTORY_RETENTION_CRON = '15 3 * * *';

/**
 * Deletes chatbot turns past the retention window once a day. Registered after
 * Discord is ready like the other jobs, which keeps every worker off while a
 * migration is pending. Running twice deletes nothing more, and a failed run
 * throws so pg-boss retries it.
 */
@Injectable()
export class ChatbotHistoryCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChatbotHistoryCron.name);

  constructor(
    private readonly boss: PgBossService,
    private readonly ready: DiscordReadyService,
    private readonly history: ChatbotHistoryService,
  ) {}

  onApplicationBootstrap(): void {
    this.ready.afterReady('chatbot-history-retention', () => this.start());
  }

  private async start(): Promise<void> {
    await this.boss.work(QUEUES.chatbotHistoryRetention, {}, async () => {
      const deleted = await this.history.purgeOlderThan(CHATBOT_HISTORY_RETENTION_DAYS);
      this.logger.log(`Chatbot history retention deleted ${deleted} turn(s)`);
    });
    await this.boss.schedule(QUEUES.chatbotHistoryRetention, CHATBOT_HISTORY_RETENTION_CRON, {});
  }
}
