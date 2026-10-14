import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  PrivateThreadCreateSchema,
  PrivateThreadFromReactorsSchema,
  PrivateThreadResultSchema,
  ThreadBatchPlanSchema,
  ThreadBatchResultSchema,
  ThreadCreateRequestSchema,
  ThreadCreateResultSchema,
  ThreadDeleteRequestSchema,
  ThreadRenameRequestSchema,
  type PrivateThreadResult,
  type ThreadBatchPlan,
  type ThreadBatchResult,
  type ThreadCreateResult,
  type z,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { GuildActionLimiter } from '../../common/limiter/guild-action.limiter.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { PrivateThreadService } from './private-thread.service.js';
import { ThreadService } from './thread.service.js';

/**
 * Threads. Creating posts a first message, so it spends the server's message
 * budget (`GuildActionLimiter`), as does opening private threads. Renaming or
 * deleting by prefix previews with `dryRun` or runs with `confirm: true`; the
 * preview is the service's. Over HTTP the messages ping nobody, and a link to
 * a message in another server is refused (no `crossGuild`).
 */
@Controller('api/guilds/:guildId/threads')
@UseGuards(ManageGuildGuard)
export class ThreadController {
  constructor(
    private readonly threads: ThreadService,
    private readonly privateThreads: PrivateThreadService,
    private readonly limiter: GuildActionLimiter,
  ) {}

  @Post()
  async create(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ThreadCreateRequestSchema }) body: z.infer<typeof ThreadCreateRequestSchema>,
  ): Promise<ThreadCreateResult> {
    this.limiter.consume(guildId, 'message');
    const result = await this.threads.create(guildId, body, httpActor(principal));
    return ThreadCreateResultSchema.parse(result);
  }

  @Post('rename')
  @HttpCode(200)
  async rename(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ThreadRenameRequestSchema }) body: z.infer<typeof ThreadRenameRequestSchema>,
  ): Promise<ThreadBatchPlan | ThreadBatchResult> {
    const outcome = await this.threads.renameByPrefix(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return body.dryRun
      ? ThreadBatchPlanSchema.parse(outcome)
      : ThreadBatchResultSchema.parse(outcome);
  }

  @Post('delete')
  @HttpCode(200)
  async remove(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ThreadDeleteRequestSchema }) body: z.infer<typeof ThreadDeleteRequestSchema>,
  ): Promise<ThreadBatchPlan | ThreadBatchResult> {
    const outcome = await this.threads.deleteByPrefix(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return body.dryRun
      ? ThreadBatchPlanSchema.parse(outcome)
      : ThreadBatchResultSchema.parse(outcome);
  }

  @Post('private')
  async createPrivate(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: PrivateThreadCreateSchema }) body: z.infer<typeof PrivateThreadCreateSchema>,
  ): Promise<PrivateThreadResult> {
    this.limiter.consume(guildId, 'message');
    const result = await this.privateThreads.createPrivateThreads(
      guildId,
      body,
      httpActor(principal),
    );
    return PrivateThreadResultSchema.parse(result);
  }

  @Post('private/reactors')
  async createPrivateFromReactors(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: PrivateThreadFromReactorsSchema })
    body: z.infer<typeof PrivateThreadFromReactorsSchema>,
  ): Promise<PrivateThreadResult> {
    this.limiter.consume(guildId, 'message');
    const result = await this.privateThreads.createPrivateThreadsFromReactors(
      guildId,
      body,
      httpActor(principal),
    );
    return PrivateThreadResultSchema.parse(result);
  }
}
