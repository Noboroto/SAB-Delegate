import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  MentionNonReactorsInputSchema,
  MentionReactorsInputSchema,
  MentionResultSchema,
  z,
  type MentionResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { GuildActionLimiter } from '../../common/limiter/guild-action.limiter.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { MentionService } from './mention.service.js';

const dryRunFlag = { dryRun: z.boolean().default(false) };
const ReactorsBodySchema = MentionReactorsInputSchema.extend(dryRunFlag);
const NonReactorsBodySchema = MentionNonReactorsInputSchema.extend(dryRunFlag);

/**
 * Lists people for a message. Over HTTP the service never pings anybody and
 * stays inside this server; `mentionEveryoneInThread` is a slash-command-only
 * reach, so it has no route here. The posted reply (`replyTo` / `reply`) is the
 * only thing that writes, so only that spends the server's message budget.
 */
@Controller('api/guilds/:guildId/mention')
@UseGuards(ManageGuildGuard)
export class MentionController {
  constructor(
    private readonly mentions: MentionService,
    private readonly limiter: GuildActionLimiter,
  ) {}

  @Post('reactors')
  @HttpCode(200)
  async reactors(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ReactorsBodySchema }) body: z.infer<typeof ReactorsBodySchema>,
  ): Promise<MentionResult> {
    if (!body.dryRun && body.replyTo !== undefined) this.limiter.consume(guildId, 'message');
    const result = await this.mentions.mentionReactors(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return MentionResultSchema.parse(result);
  }

  @Post('non-reactors')
  @HttpCode(200)
  async nonReactors(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: NonReactorsBodySchema }) body: z.infer<typeof NonReactorsBodySchema>,
  ): Promise<MentionResult> {
    if (!body.dryRun && body.reply) this.limiter.consume(guildId, 'message');
    const result = await this.mentions.mentionNonReactors(guildId, body, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return MentionResultSchema.parse(result);
  }
}
