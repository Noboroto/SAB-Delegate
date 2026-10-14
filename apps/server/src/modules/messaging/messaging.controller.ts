import { Body, Controller, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CopyMessageResultSchema,
  CopyMessageSchema,
  CreateReactionPollRequestSchema,
  CreateReactionPollResultSchema,
  EditBotMessageRequestSchema,
  EditBotMessageResultSchema,
  MessageTargetSchema,
  ReactToMessageResultSchema,
  ReactToMessageSchema,
  SendMessageRequestSchema,
  SendMessageResultSchema,
  z,
  type CopyMessage,
  type CopyMessageResult,
  type CreateReactionPollResult,
  type EditBotMessageResult,
  type MessageTarget,
  type ReactToMessage,
  type ReactToMessageResult,
  type SendMessageResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { GuildActionLimiter } from '../../common/limiter/guild-action.limiter.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { MessagingService } from './messaging.service.js';

/**
 * What the bot posts, copies, edits and reacts to. Every action that really
 * posts spends the server's message allowance first (a `dryRun` preview sends
 * nothing and spends none), so a busy dashboard cannot use up the
 * bot's Discord limits. The API never pings and stays inside the path server
 * (the service enforces both for a non-slash caller).
 */
@Controller('api/guilds/:guildId/messages')
@UseGuards(ManageGuildGuard)
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly limiter: GuildActionLimiter,
  ) {}

  @Post('send')
  @HttpCode(200)
  async send(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: SendMessageRequestSchema }) body: z.output<typeof SendMessageRequestSchema>,
  ): Promise<SendMessageResult> {
    if (!body.dryRun) this.limiter.consume(guildId, 'message');
    const { dryRun, ...input } = body;
    return SendMessageResultSchema.parse(
      await this.messaging.sendMessage(guildId, input, httpActor(principal), { dryRun }),
    );
  }

  @Post('copy')
  @HttpCode(200)
  async copy(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: CopyMessageSchema }) body: CopyMessage,
  ): Promise<CopyMessageResult> {
    this.limiter.consume(guildId, 'message');
    return CopyMessageResultSchema.parse(
      await this.messaging.copyMessage(guildId, body, httpActor(principal)),
    );
  }

  @Post('react')
  @HttpCode(200)
  async react(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: ReactToMessageSchema }) body: ReactToMessage,
  ): Promise<ReactToMessageResult> {
    this.limiter.consume(guildId, 'message');
    return ReactToMessageResultSchema.parse(
      await this.messaging.reactToMessage(guildId, body, httpActor(principal)),
    );
  }

  @Post('poll')
  @HttpCode(200)
  async poll(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: CreateReactionPollRequestSchema })
    body: z.output<typeof CreateReactionPollRequestSchema>,
  ): Promise<CreateReactionPollResult> {
    if (!body.dryRun) this.limiter.consume(guildId, 'message');
    const { dryRun, ...input } = body;
    return CreateReactionPollResultSchema.parse(
      await this.messaging.createReactionPoll(guildId, input, httpActor(principal), { dryRun }),
    );
  }

  /** Replaces the text of a message the bot sent; the message is named by the route. */
  @Patch(':channelId/:messageId')
  async edit(
    @Param('guildId') guildId: string,
    @Param({ schema: MessageTargetSchema }) target: MessageTarget,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: EditBotMessageRequestSchema })
    body: z.output<typeof EditBotMessageRequestSchema>,
  ): Promise<EditBotMessageResult> {
    if (!body.dryRun) this.limiter.consume(guildId, 'message');
    return EditBotMessageResultSchema.parse(
      await this.messaging.editBotMessage(
        guildId,
        { target, content: body.content },
        httpActor(principal),
        { dryRun: body.dryRun },
      ),
    );
  }
}
