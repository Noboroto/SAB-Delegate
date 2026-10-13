import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, REACTION_EMOJI_MAX_LENGTH } from '../constants/limits.js';
import { LocaleSchema } from '../utils/locale.js';
import { SnowflakeSchema } from './snowflake.js';

/** The text a person adds to a mention list; the list itself is split across messages, this is not. */
export const MENTION_CONTENT_MAX_LENGTH = MESSAGE_MAX_LENGTH;

/**
 * `@everyone` in a thread leaves room in the 2000 characters for the line that
 * names who asked.
 */
export const MENTION_EVERYONE_CONTENT_MAX_LENGTH = 1900;

/** How many ids a plan or a result shows; the full list goes into the messages. */
export const MENTION_SAMPLE_SIZE = 10;

/** A message anywhere the bot can read. */
export const MentionMessageRefSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
});

export type MentionMessageRef = z.infer<typeof MentionMessageRefSchema>;

const ContentSchema = z.string().max(MENTION_CONTENT_MAX_LENGTH);

/**
 * Mention everyone who reacted to a message with one emoji. With `replyTo` the
 * list is posted as a reply to that message; without it the messages are
 * handed back for the caller to post (the slash command answers with them).
 * `locale` is the language the sentence around the list is written in.
 */
export const MentionReactorsInputSchema = MentionMessageRefSchema.extend({
  emoji: z.string().trim().min(1).max(REACTION_EMOJI_MAX_LENGTH),
  content: ContentSchema.optional(),
  replyTo: MentionMessageRefSchema.optional(),
  locale: LocaleSchema.optional(),
});

export type MentionReactorsInput = z.infer<typeof MentionReactorsInputSchema>;

/**
 * Mention the members who did not react to a message. `roleId` narrows who is
 * expected to react; `onlyInChannel: false` then takes every member of the role
 * instead of those who can see the channel. `reply` posts the list as a reply
 * to the message itself, else it is handed back.
 */
export const MentionNonReactorsInputSchema = MentionMessageRefSchema.extend({
  content: ContentSchema.optional(),
  roleId: SnowflakeSchema.optional(),
  includeBots: z.boolean().default(false),
  onlyInChannel: z.boolean().default(true),
  reply: z.boolean().default(false),
  locale: LocaleSchema.optional(),
});

export type MentionNonReactorsInput = z.input<typeof MentionNonReactorsInputSchema>;

/** Ping everyone in a thread, optionally as a reply to one of its messages. */
export const MentionEveryoneInputSchema = z.object({
  threadId: SnowflakeSchema,
  content: z.string().max(MENTION_EVERYONE_CONTENT_MAX_LENGTH).optional(),
  replyTo: MentionMessageRefSchema.optional(),
  locale: LocaleSchema.optional(),
});

export type MentionEveryoneInput = z.infer<typeof MentionEveryoneInputSchema>;

/**
 * `OK`: a list was made. `NO_REACTORS` / `ALL_REACTED`: there was nobody to
 * list. `UNSUPPORTED_CHANNEL`: voice and stage channels, and anything that is
 * not text or a thread. `SEND_FAILED`: the list was made but Discord refused
 * the reply; `failure` says why.
 */
export const MentionStatusSchema = z.enum([
  'OK',
  'NO_REACTORS',
  'ALL_REACTED',
  'UNSUPPORTED_CHANNEL',
  'SEND_FAILED',
]);

export type MentionStatus = z.infer<typeof MentionStatusSchema>;

export const MentionResultSchema = z.object({
  dryRun: z.boolean(),
  status: MentionStatusSchema,
  /** Members named in the list. */
  count: z.number().int().min(0),
  sample: z.array(SnowflakeSchema).max(MENTION_SAMPLE_SIZE),
  /** The messages to post, each within Discord's limit; empty when there was nobody to list. */
  chunks: z.array(z.string().min(1).max(MESSAGE_MAX_LENGTH)),
  /** True once the service itself posted `chunks` (a reply target was given). */
  delivered: z.boolean(),
  failure: z.string().max(200).optional(),
});

export type MentionResult = z.infer<typeof MentionResultSchema>;

export const MentionEveryoneStatusSchema = z.enum(['OK', 'NOT_A_THREAD', 'SEND_FAILED']);

export type MentionEveryoneStatus = z.infer<typeof MentionEveryoneStatusSchema>;

export const MentionEveryoneResultSchema = z.object({
  dryRun: z.boolean(),
  status: MentionEveryoneStatusSchema,
  /** The message as it is (or would be) posted; empty when the channel is not a thread. */
  text: z.string().max(MESSAGE_MAX_LENGTH),
  failure: z.string().max(200).optional(),
});

export type MentionEveryoneResult = z.infer<typeof MentionEveryoneResultSchema>;
