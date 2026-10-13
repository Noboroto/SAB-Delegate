import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, REACTION_EMOJI_MAX_LENGTH } from '../constants/limits.js';
import { SnowflakeSchema } from './snowflake.js';

/** The numbered emoji a poll reacts with, in the order the choices are numbered. */
export const POLL_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const;

export const POLL_CHOICES_MAX = POLL_EMOJIS.length;

/** The text of the message a poll is created on when none is named. */
export const POLL_PLACEHOLDER_TEXT = 'New Poll!';

/** Stored as written (line breaks matter) but never blank: Discord refuses an empty message. */
export const MessageContentSchema = z
  .string()
  .max(MESSAGE_MAX_LENGTH)
  .refine((content) => content.trim() !== '', { message: 'content must not be blank' });

/** One message, named by where it lives. */
export const MessageTargetSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
});

export type MessageTarget = z.infer<typeof MessageTargetSchema>;

const ReactionEmojiSchema = z.string().trim().min(1).max(REACTION_EMOJI_MAX_LENGTH);

/** `replyTo` wins over `channelId`: a reply is posted where the replied-to message is. */
export const SendMessageSchema = z.object({
  channelId: SnowflakeSchema,
  content: MessageContentSchema,
  replyTo: MessageTargetSchema.optional(),
});

export type SendMessage = z.infer<typeof SendMessageSchema>;

/** What a send did, or with `dryRun` what it would do; `messageId` is null then. */
export const SendMessageResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  replyToMessageId: SnowflakeSchema.nullable(),
  content: z.string(),
  /** Mentions in the text that would notify somebody; always empty for the API and MCP. */
  pings: z.array(z.string()),
  dryRun: z.boolean(),
});

export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

export const CopyMessageSchema = z.object({
  source: MessageTargetSchema,
  channelId: SnowflakeSchema,
});

export type CopyMessage = z.infer<typeof CopyMessageSchema>;

export const CopyMessageResultSchema = z.object({
  status: z.enum(['COPIED', 'NOTHING_TO_COPY']),
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
});

export type CopyMessageResult = z.infer<typeof CopyMessageResultSchema>;

export const EditBotMessageSchema = z.object({
  target: MessageTargetSchema,
  content: MessageContentSchema,
});

export type EditBotMessage = z.infer<typeof EditBotMessageSchema>;

export const EditBotMessageFromCopySchema = z.object({
  target: MessageTargetSchema,
  source: MessageTargetSchema,
});

export type EditBotMessageFromCopy = z.infer<typeof EditBotMessageFromCopySchema>;

/**
 * `NOT_BOT_MESSAGE`: only the bot's own messages can be edited, and nothing was
 * changed. `NOTHING_TO_COPY`: the message to copy from has no text or file.
 */
export const EditBotMessageResultSchema = z.object({
  status: z.enum(['EDITED', 'NOT_BOT_MESSAGE', 'NOTHING_TO_COPY']),
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
  /** The text the message has, or with `dryRun` would have; null when it is not known. */
  content: z.string().nullable(),
  dryRun: z.boolean(),
});

export type EditBotMessageResult = z.infer<typeof EditBotMessageResultSchema>;

export const ReactToMessageSchema = z.object({
  target: MessageTargetSchema,
  emoji: ReactionEmojiSchema,
  /** How many numbered choices (1, 2, ...) to add after the emoji. */
  pollChoices: z.number().int().min(0).max(POLL_CHOICES_MAX).default(0),
});

export type ReactToMessage = z.infer<typeof ReactToMessageSchema>;

export const ReactToMessageResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
  /** Reactions added: the emoji plus the poll choices. */
  count: z.number().int().min(1),
});

export type ReactToMessageResult = z.infer<typeof ReactToMessageResultSchema>;

/** Without `messageId` the poll is posted as a new message in `channelId`. */
export const CreateReactionPollSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.optional(),
  choices: z.number().int().min(1).max(POLL_CHOICES_MAX),
});

export type CreateReactionPoll = z.infer<typeof CreateReactionPollSchema>;

export const CreateReactionPollResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema.nullable(),
  /** True when the poll message is new rather than an existing one. */
  created: z.boolean(),
  emojis: z.array(z.string()),
  dryRun: z.boolean(),
});

export type CreateReactionPollResult = z.infer<typeof CreateReactionPollResultSchema>;
