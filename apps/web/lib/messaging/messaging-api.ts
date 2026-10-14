import {
  CopyMessageResultSchema,
  CopyMessageSchema,
  CreateReactionPollRequestSchema,
  CreateReactionPollResultSchema,
  EditBotMessageRequestSchema,
  EditBotMessageResultSchema,
  ReactToMessageResultSchema,
  ReactToMessageSchema,
  SendMessageRequestSchema,
  SendMessageResultSchema,
  type CopyMessage,
  type CopyMessageResult,
  type CreateReactionPoll,
  type CreateReactionPollResult,
  type EditBotMessageResult,
  type MessageTarget,
  type ReactToMessage,
  type ReactToMessageResult,
  type SendMessage,
  type SendMessageResult,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath, snowflakeSegment } from '@/lib/guild-path';

const base = (guildId: string) => guildApiPath(guildId, 'messages');

/** With `dryRun` the service posts nothing and answers with the message as it would be posted. */
export function sendMessage(
  guildId: string,
  input: SendMessage,
  dryRun: boolean,
): Promise<SendMessageResult> {
  return apiFetch(`${base(guildId)}/send`, {
    method: 'POST',
    body: SendMessageRequestSchema.parse({ ...input, dryRun }),
    parser: SendMessageResultSchema,
  });
}

export function copyMessage(guildId: string, input: CopyMessage): Promise<CopyMessageResult> {
  return apiFetch(`${base(guildId)}/copy`, {
    method: 'POST',
    body: CopyMessageSchema.parse(input),
    parser: CopyMessageResultSchema,
  });
}

export function reactToMessage(
  guildId: string,
  input: ReactToMessage,
): Promise<ReactToMessageResult> {
  return apiFetch(`${base(guildId)}/react`, {
    method: 'POST',
    body: ReactToMessageSchema.parse(input),
    parser: ReactToMessageResultSchema,
  });
}

export function createReactionPoll(
  guildId: string,
  input: CreateReactionPoll,
  dryRun: boolean,
): Promise<CreateReactionPollResult> {
  return apiFetch(`${base(guildId)}/poll`, {
    method: 'POST',
    body: CreateReactionPollRequestSchema.parse({ ...input, dryRun }),
    parser: CreateReactionPollResultSchema,
  });
}

/** The message is named by the route, the new text by the body. */
export function editBotMessage(
  guildId: string,
  input: { target: MessageTarget; content: string },
  dryRun: boolean,
): Promise<EditBotMessageResult> {
  return apiFetch(
    guildApiPath(
      guildId,
      'messages',
      snowflakeSegment(input.target.channelId),
      snowflakeSegment(input.target.messageId),
    ),
    {
      method: 'PATCH',
      body: EditBotMessageRequestSchema.parse({ content: input.content, dryRun }),
      parser: EditBotMessageResultSchema,
    },
  );
}
