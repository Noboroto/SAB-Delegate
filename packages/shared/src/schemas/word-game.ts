import { z } from 'zod';
import { WordGameStateSchema } from '../generated/zod/schemas/models/WordGameState.schema.js';
import { PaginatedSchema, PaginationQuerySchema } from './pagination.js';
import { WORD_MAX_WORDS_MAX, WORD_MAX_WORDS_MIN } from './guild-config.js';
import { SnowflakeSchema } from './snowflake.js';

/**
 * How a message in the game channel was judged. `NOTHING` means the message is
 * not a move at all (several words, empty, another channel, no game set up) and
 * gets no reaction; `MAX_WORD` means the round already reached its limit and is
 * ignored until someone resets it.
 */
export const WordStatusSchema = z.enum([
  'SUCCESS',
  'SAME_AUTHOR',
  'SAME_WORD',
  'NOT_EXIST',
  'NOT_LINK',
  'MAX_WORD',
  'NOTHING',
]);

export type WordStatus = z.infer<typeof WordStatusSchema>;

/** `WordStatus.SUCCESS` style access without repeating string literals. */
export const WordStatus = WordStatusSchema.enum;

/** The same limits as the stored setting, so a request fails here and not at the CHECK. */
const MaxWordsSchema = z.number().int().min(WORD_MAX_WORDS_MIN).max(WORD_MAX_WORDS_MAX);

/**
 * Input of `WordGameService.configure` (`/word set`, REST, MCP). A new channel
 * starts a new round; a limit alone leaves the round that is being played alone.
 */
export const WordGameConfigSchema = z
  .object({
    channelId: SnowflakeSchema.optional(),
    maxWords: MaxWordsSchema.optional(),
  })
  .refine((config) => config.channelId !== undefined || config.maxWords !== undefined, {
    message: 'channelId or maxWords is required',
  });

export type WordGameConfig = z.infer<typeof WordGameConfigSchema>;

export const WordGameSettingsSchema = z.object({
  channelId: SnowflakeSchema.nullable(),
  maxWords: MaxWordsSchema,
});

export type WordGameSettings = z.infer<typeof WordGameSettingsSchema>;

/**
 * What `configure` did, or with `dryRun` what it would do. `clearedWords` and
 * `sample` describe the used words a new round wipes (a sample, not the list).
 */
export const WordGameConfigResultSchema = z.object({
  before: WordGameSettingsSchema,
  after: WordGameSettingsSchema,
  restarted: z.boolean(),
  clearedWords: z.number().int().min(0),
  sample: z.array(z.string()),
  dryRun: z.boolean(),
});

export type WordGameConfigResult = z.infer<typeof WordGameConfigResultSchema>;

export const WordGameResetStatusSchema = z.enum(['RESET', 'NOT_CONFIGURED']);

export type WordGameResetStatus = z.infer<typeof WordGameResetStatusSchema>;

/** `NOT_CONFIGURED`: the server has no word channel, so there is no round to reset. */
export const WordGameResetResultSchema = z.object({
  status: WordGameResetStatusSchema,
  channelId: SnowflakeSchema.nullable(),
  clearedWords: z.number().int().min(0),
  sample: z.array(z.string()),
  dryRun: z.boolean(),
});

export type WordGameResetResult = z.infer<typeof WordGameResetResultSchema>;

/** The current round together with the settings that bound it. */
export const WordGameInfoSchema = WordGameStateSchema.pick({
  started: true,
  lastWord: true,
  lastUserId: true,
}).extend({
  channelId: SnowflakeSchema.nullable(),
  maxWords: MaxWordsSchema,
  count: z.number().int().min(0),
  /** True once `count` reached `maxWords`: the round accepts nothing more. */
  finished: z.boolean(),
});

export type WordGameInfo = z.infer<typeof WordGameInfoSchema>;

/** A message as the listener hands it over; the service decides what it is. */
export const WordSubmitInputSchema = z.object({
  channelId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  content: z.string(),
});

export type WordSubmitInput = z.infer<typeof WordSubmitInputSchema>;

export const WordSubmitResultSchema = z.object({
  status: WordStatusSchema,
  /** Words accepted in the round, this one included on `SUCCESS`. */
  count: z.number().int().min(0),
  /** 0 when the message was not a move and no round was looked up. */
  maxWords: z.number().int().min(0),
  /** The letter the next word has to start with; only set for `NOT_LINK`. */
  starter: z.string().optional(),
  /** True when this very word was the last one the round allows. */
  finished: z.boolean(),
});

export type WordSubmitResult = z.infer<typeof WordSubmitResultSchema>;

/** Used words are listed in play order (the id is time-ordered) or alphabetically. */
export const WordGameWordsQuerySchema = PaginationQuerySchema.extend({
  sort: z.enum(['played', 'word']).default('played'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export type WordGameWordsQuery = z.infer<typeof WordGameWordsQuerySchema>;

export const WordGameWordSchema = z.object({ word: z.string() });

export type WordGameWord = z.infer<typeof WordGameWordSchema>;

export const WordGameWordsPageSchema = PaginatedSchema(WordGameWordSchema);

export type WordGameWordsPage = z.infer<typeof WordGameWordsPageSchema>;
