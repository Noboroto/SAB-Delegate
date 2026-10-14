import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ScheduleCancelResultSchema,
  ScheduleCreateRequestSchema,
  ScheduleCreateResultSchema,
  ScheduleListRequestSchema,
  ScheduleSeqParamSchema,
  ScheduledMessageViewSchema,
  destructiveQueryShape,
  z,
  type ScheduleCancelResult,
  type ScheduleCreateResult,
  type ScheduledMessageView,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { GuildActionLimiter } from '../../common/limiter/guild-action.limiter.js';
import { requireConfirmation } from '../../common/rest/rest-support.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { ScheduleService } from './schedule.service.js';

const CancelQuerySchema = requireConfirmation(z.object(destructiveQueryShape));

/** Messages the bot sends later. The API never schedules a ping and only reads sources in the same server. */
@Controller('api/guilds/:guildId/schedules')
@UseGuards(ManageGuildGuard)
export class ScheduleController {
  constructor(
    private readonly schedules: ScheduleService,
    private readonly limiter: GuildActionLimiter,
  ) {}

  @Get()
  async list(
    @Param('guildId') guildId: string,
    @Query({ schema: ScheduleListRequestSchema }) query: z.output<typeof ScheduleListRequestSchema>,
  ): Promise<ScheduledMessageView[]> {
    const messages = await this.schedules.list(guildId, query);
    return z.array(ScheduledMessageViewSchema).parse(messages);
  }

  /** `kind: "send"` schedules text, `kind: "copy"` schedules a copy of a message; `dryRun` previews. */
  @Post()
  async create(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ScheduleCreateRequestSchema })
    body: z.output<typeof ScheduleCreateRequestSchema>,
  ): Promise<ScheduleCreateResult> {
    const { kind, dryRun, ...input } = body;
    if (!dryRun) this.limiter.consume(guildId, 'schedule');
    const actor = httpActor(principal);
    const result =
      kind === 'send'
        ? await this.schedules.scheduleSend(guildId, input, actor, { dryRun })
        : await this.schedules.scheduleCopy(guildId, input, actor, { dryRun });
    return ScheduleCreateResultSchema.parse(result);
  }

  /** `:id` is the number `GET schedules` shows as `seq`. */
  @Delete(':id')
  async cancel(
    @Param('guildId') guildId: string,
    @Param({ schema: ScheduleSeqParamSchema }) params: z.output<typeof ScheduleSeqParamSchema>,
    @Principal() principal: SessionPrincipal,
    @Query({ schema: CancelQuerySchema }) query: z.output<typeof CancelQuerySchema>,
  ): Promise<ScheduleCancelResult> {
    return ScheduleCancelResultSchema.parse(
      await this.schedules.cancel(guildId, params.id, httpActor(principal), {
        dryRun: query.dryRun,
      }),
    );
  }
}
