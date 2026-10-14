import {
  AUDIT_ACTIONS,
  CreateReactionPollRequestSchema,
  EditBotMessageRequestSchema,
  MessageContentSchema,
  POLL_CHOICES_MAX,
  SendMessageRequestSchema,
  SnowflakeSchema,
  z,
} from '@sab/shared';
import { GuildActionLimiter } from '../../common/limiter/guild-action.limiter.js';
import { MessagingService } from '../../modules/messaging/messaging.service.js';
import { defineTool, type AnyToolRow } from '../tool-definition.js';
import { toolInputSchema } from '../write-guard.js';

const guildId = SnowflakeSchema.describe('Id of the Discord server (guild).');
const channelId = SnowflakeSchema.describe('Channel of this server.');

/** The least a poll needs: one option is not a vote. */
// REST accepts 1 option; a poll of one cannot be voted on meaningfully, so the tool asks for 2.
const POLL_CHOICES_MIN = 2;

export const MESSAGE_TOOLS: readonly AnyToolRow[] = [
  defineTool({
    name: 'message_send',
    class: 'C',
    service: 'MessagingService.sendMessage',
    inputSchema: toolInputSchema('C', {
      guildId,
      channelId,
      content: MessageContentSchema.describe('Message text, at most 2000 characters.'),
      replyToMessageId: SnowflakeSchema.optional().describe(
        'Reply to this message of the same channel instead of posting a plain message.',
      ),
    }),
    description:
      'Posts a public message as the bot in a channel of this server, optionally as a reply. Everyone in the channel sees it at once and it cannot be undone by this API (only a person can delete it in Discord). It never notifies anyone: mentions in the text do not ping. Use dryRun to preview and get the confirmToken.',
    audit: AUDIT_ACTIONS.messageSend,
    effect: 'post a public message',
    parity: {
      rest: SendMessageRequestSchema,
      exceptions: {
        replyTo: 'MCP names replyToMessageId; the reply is posted in channelId.',
      },
    },
    handler: ({ args, dryRun, actor, service }) => {
      if (!dryRun) service(GuildActionLimiter).consume(args.guildId, 'message');
      return service(MessagingService).sendMessage(
        args.guildId,
        {
          channelId: args.channelId,
          content: args.content,
          ...(args.replyToMessageId !== undefined && {
            replyTo: { channelId: args.channelId, messageId: args.replyToMessageId },
          }),
        },
        actor,
        { dryRun },
      );
    },
  }),

  defineTool({
    name: 'message_edit',
    class: 'C',
    service: 'MessagingService.editBotMessage',
    inputSchema: toolInputSchema('C', {
      guildId,
      channelId,
      messageId: SnowflakeSchema.describe('The bot message to edit.'),
      content: MessageContentSchema.describe('The new text, at most 2000 characters.'),
    }),
    description:
      'Replaces the text of a message the bot itself sent in this server. A message from anyone else is left alone and answers NOT_BOT_MESSAGE. The edit is visible at once and the old text is not kept, so it cannot be undone except by editing again with the old text. Mentions in the new text do not ping. Use dryRun to preview and get the confirmToken.',
    audit: AUDIT_ACTIONS.messageEdit,
    effect: "edit one of the bot's messages",
    parity: { rest: EditBotMessageRequestSchema },
    handler: ({ args, dryRun, actor, service }) => {
      if (!dryRun) service(GuildActionLimiter).consume(args.guildId, 'message');
      return service(MessagingService).editBotMessage(
        args.guildId,
        {
          target: { channelId: args.channelId, messageId: args.messageId },
          content: args.content,
        },
        actor,
        { dryRun },
      );
    },
  }),

  defineTool({
    name: 'poll_create',
    class: 'C',
    service: 'MessagingService.createReactionPoll',
    inputSchema: toolInputSchema('C', {
      guildId,
      channelId,
      messageId: SnowflakeSchema.optional().describe(
        'Put the numbers on this existing message of the channel (use message_send first to write the question). Without it a new message reading "New Poll!" is posted.',
      ),
      choices: z
        .number()
        .int()
        .min(POLL_CHOICES_MIN)
        .max(POLL_CHOICES_MAX)
        .describe('How many numbered options (1, 2, ...) members can vote with.'),
    }),
    description:
      'Starts a reaction poll: numbers the options on a message with the reactions 1 to N, posting a new message first when none is named. This is public and cannot be undone by this API (a person removes the reactions or the message in Discord). It carries no question text of its own: write the question with message_send and pass its id as messageId. At least 2 options. Call with dryRun first to get a confirmToken.',
    audit: AUDIT_ACTIONS.pollCreate,
    effect: 'start a public poll',
    parity: { rest: CreateReactionPollRequestSchema },
    handler: ({ args, dryRun, actor, service }) => {
      if (!dryRun) service(GuildActionLimiter).consume(args.guildId, 'message');
      return service(MessagingService).createReactionPoll(
        args.guildId,
        {
          channelId: args.channelId,
          choices: args.choices,
          ...(args.messageId !== undefined && { messageId: args.messageId }),
        },
        actor,
        { dryRun },
      );
    },
  }),
];
