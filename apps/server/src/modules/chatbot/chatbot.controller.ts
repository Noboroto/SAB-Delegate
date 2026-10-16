import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ChatbotChannelRequestSchema,
  ChatbotConfigPatchSchema,
  ChatbotConfigSchema,
  ChatbotLlmOverrideInputSchema,
  ChatbotMemoryClearRequestSchema,
  ChatbotMemoryClearResultSchema,
  ChatbotQuotaGrantRequestSchema,
  ChatbotQuotaListQuerySchema,
  ChatbotQuotaPageSchema,
  ChatbotQuotaResetRequestSchema,
  ChatbotQuotaResetResultSchema,
  ChatbotQuotaRowSchema,
  ChatbotQuotaSetRequestSchema,
  ChatbotTurnDeleteRequestSchema,
  ChatbotTurnDeleteResultSchema,
  ChatbotTurnDetailSchema,
  ChatbotTurnListQuerySchema,
  ChatbotTurnPageSchema,
  ChatbotTurnParamSchema,
  ChatbotUserParamSchema,
  ErrorCode,
  LlmTestResultSchema,
  z,
  type ChatbotConfig,
  type ChatbotMemoryClearResult,
  type ChatbotQuotaPage,
  type ChatbotQuotaResetResult,
  type ChatbotQuotaRow,
  type ChatbotTurnDeleteResult,
  type ChatbotTurnDetail,
  type ChatbotTurnPage,
  type LlmTestResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { FreshAuthGuard } from '../../auth/session.guard.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotNamesService } from './chatbot-names.service.js';
import { quotaPage, turnPage, withDisplayNames } from './chatbot-pages.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';

type Quota = Omit<ChatbotQuotaRow, 'userId' | 'displayName'>;

/**
 * The chatbot of a server for its managers: the guard checks Manage Server on
 * `guildId` and nothing else is asked. Every response is parsed through its
 * shared schema, so the override's key material cannot leave in one.
 */
@Controller('api/guilds/:guildId/chatbot')
@UseGuards(ManageGuildGuard)
export class ChatbotController {
  constructor(
    private readonly config: ChatbotConfigService,
    private readonly quota: ChatbotQuotaService,
    private readonly memory: ChatbotMemoryService,
    private readonly history: ChatbotHistoryService,
    private readonly names: ChatbotNamesService,
  ) {}

  @Get()
  async get(@Param('guildId') guildId: string): Promise<ChatbotConfig> {
    return ChatbotConfigSchema.parse(await this.config.get(guildId));
  }

  @Patch('config')
  async configure(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ChatbotConfigPatchSchema }) body: z.output<typeof ChatbotConfigPatchSchema>,
  ): Promise<ChatbotConfig> {
    return ChatbotConfigSchema.parse(
      await this.config.configure(guildId, body, httpActor(principal)),
    );
  }

  /** Answering in a channel again is not an error, so a repeat answers like the first call. */
  @Put('channels/:channelId')
  async addChannel(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: ChatbotChannelRequestSchema })
    params: z.output<typeof ChatbotChannelRequestSchema>,
  ): Promise<ChatbotConfig> {
    await this.config.addChannel(guildId, params.channelId, httpActor(principal));
    return ChatbotConfigSchema.parse(await this.config.get(guildId));
  }

  @Delete('channels/:channelId')
  async removeChannel(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: ChatbotChannelRequestSchema })
    params: z.output<typeof ChatbotChannelRequestSchema>,
  ): Promise<ChatbotConfig> {
    await this.config.removeChannel(guildId, params.channelId, httpActor(principal));
    return ChatbotConfigSchema.parse(await this.config.get(guildId));
  }

  /** A recent login only: the key and the address calls go to are changed here. */
  @Put('llm')
  @UseGuards(FreshAuthGuard)
  async saveLlm(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ChatbotLlmOverrideInputSchema })
    body: z.output<typeof ChatbotLlmOverrideInputSchema>,
  ): Promise<ChatbotConfig> {
    return ChatbotConfigSchema.parse(
      await this.config.saveOverride(guildId, body, httpActor(principal)),
    );
  }

  @Delete('llm')
  @UseGuards(FreshAuthGuard)
  async clearLlm(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
  ): Promise<ChatbotConfig> {
    return ChatbotConfigSchema.parse(
      await this.config.clearOverride(guildId, httpActor(principal)),
    );
  }

  @Post('llm/test')
  @HttpCode(200)
  async testLlm(
    @Param('guildId') guildId: string,
    @Body({ schema: ChatbotLlmOverrideInputSchema })
    body: z.output<typeof ChatbotLlmOverrideInputSchema>,
  ): Promise<LlmTestResult> {
    return LlmTestResultSchema.parse(await this.config.testOverride(guildId, body));
  }

  @Get('quota')
  async listQuota(
    @Param('guildId') guildId: string,
    @Query({ schema: ChatbotQuotaListQuerySchema })
    query: z.output<typeof ChatbotQuotaListQuerySchema>,
  ): Promise<ChatbotQuotaPage> {
    const page = await quotaPage(this.quota, guildId, query);
    const items = await withDisplayNames(this.names, guildId, page.items);
    return ChatbotQuotaPageSchema.parse({ ...page, items });
  }

  /** `limit: null` drops the member's own limit. */
  @Put('quota/:userId')
  async setQuota(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: ChatbotUserParamSchema }) params: z.output<typeof ChatbotUserParamSchema>,
    @Body({ schema: ChatbotQuotaSetRequestSchema })
    body: z.output<typeof ChatbotQuotaSetRequestSchema>,
  ): Promise<ChatbotQuotaRow> {
    const quota = await this.quota.setLimit(
      guildId,
      params.userId,
      body.limit,
      httpActor(principal),
    );
    return this.oneRow(guildId, params.userId, quota);
  }

  @Post('quota/:userId/grant')
  @HttpCode(200)
  async grantQuota(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: ChatbotUserParamSchema }) params: z.output<typeof ChatbotUserParamSchema>,
    @Body({ schema: ChatbotQuotaGrantRequestSchema })
    body: z.output<typeof ChatbotQuotaGrantRequestSchema>,
  ): Promise<ChatbotQuotaRow> {
    const quota = await this.quota.grant(guildId, params.userId, body.tokens, httpActor(principal));
    return this.oneRow(guildId, params.userId, quota);
  }

  /** Zeroes what the member spent this month; `dryRun` says how much that is. */
  @Post('quota/:userId/reset')
  @HttpCode(200)
  async resetQuota(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Param({ schema: ChatbotUserParamSchema }) params: z.output<typeof ChatbotUserParamSchema>,
    @Body({ schema: ChatbotQuotaResetRequestSchema })
    body: z.output<typeof ChatbotQuotaResetRequestSchema>,
  ): Promise<ChatbotQuotaResetResult> {
    return ChatbotQuotaResetResultSchema.parse(
      await this.quota.reset(guildId, params.userId, httpActor(principal), {
        dryRun: body.dryRun,
      }),
    );
  }

  @Post('memory/clear')
  @HttpCode(200)
  async clearMemory(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ChatbotMemoryClearRequestSchema })
    body: z.output<typeof ChatbotMemoryClearRequestSchema>,
  ): Promise<ChatbotMemoryClearResult> {
    return ChatbotMemoryClearResultSchema.parse(
      await this.memory.clear(guildId, body, httpActor(principal)),
    );
  }

  @Get('turns')
  async listTurns(
    @Param('guildId') guildId: string,
    @Query({ schema: ChatbotTurnListQuerySchema })
    query: z.output<typeof ChatbotTurnListQuerySchema>,
  ): Promise<ChatbotTurnPage> {
    const page = await turnPage(this.history, guildId, query);
    const items = await withDisplayNames(this.names, guildId, page.items);
    return ChatbotTurnPageSchema.parse({ ...page, items });
  }

  /** `dryRun` counts what would go. A turn that is still pending is never deleted. */
  @Delete('turns')
  async deleteTurns(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ChatbotTurnDeleteRequestSchema })
    body: z.output<typeof ChatbotTurnDeleteRequestSchema>,
  ): Promise<ChatbotTurnDeleteResult> {
    return ChatbotTurnDeleteResultSchema.parse(
      await this.history.delete(guildId, body, httpActor(principal)),
    );
  }

  @Get('turns/:id')
  async getTurn(
    @Param('guildId') guildId: string,
    @Param({ schema: ChatbotTurnParamSchema }) params: z.output<typeof ChatbotTurnParamSchema>,
  ): Promise<ChatbotTurnDetail> {
    const turn = await this.history.get(guildId, params.id);
    if (turn === null) throw new ServiceError(ErrorCode.CHATBOT_TURN_NOT_FOUND);
    return ChatbotTurnDetailSchema.parse(turn);
  }

  private async oneRow(guildId: string, userId: string, quota: Quota): Promise<ChatbotQuotaRow> {
    return this.row(userId, quota, await this.names.resolve(guildId, [userId]));
  }

  private row(userId: string, quota: Quota, names: ReadonlyMap<string, string>): ChatbotQuotaRow {
    return ChatbotQuotaRowSchema.parse({
      userId,
      displayName: names.get(userId) ?? null,
      used: quota.used,
      limit: quota.limit,
      bonus: quota.bonus,
      overridden: quota.overridden,
      remaining: quota.remaining,
    });
  }
}
