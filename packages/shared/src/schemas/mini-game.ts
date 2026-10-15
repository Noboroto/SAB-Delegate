import { z } from 'zod';
import { MiniGameSchema } from '../generated/zod/schemas/enums/MiniGame.schema.js';
import { SnowflakeSchema } from './snowflake.js';

export { MiniGameSchema };
export type MiniGame = z.infer<typeof MiniGameSchema>;

/** `MiniGame.WORDLE` style access without repeating string literals. */
export const MiniGame = MiniGameSchema.enum;

/** The games played in a channel of their own; the word chain keeps its own setting. */
export const ChannelGameSchema = MiniGameSchema.exclude(['WORD_CHAIN']);
export type ChannelGame = z.infer<typeof ChannelGameSchema>;

/** The games whose puzzle can be given up and replaced. */
export const SkippableGameSchema = MiniGameSchema.extract(['SCRAMBLE', 'WORDLE']);
export type SkippableGame = z.infer<typeof SkippableGameSchema>;

export const WORDLE_WORD_LENGTH = 5;
export const WORDLE_MAX_GUESSES = 6;
export const LEADERBOARD_SIZE = 10;

/** A message as the listener hands it over; the game's service decides what it is. */
export const GameMoveInputSchema = z.object({
  channelId: SnowflakeSchema,
  authorId: SnowflakeSchema,
  content: z.string(),
});

export type GameMoveInput = z.infer<typeof GameMoveInputSchema>;

export const LeaderboardRowSchema = z.object({
  userId: SnowflakeSchema,
  points: z.number().int().min(0),
  /** 1-based; players with equal points share a rank. */
  rank: z.number().int().min(1),
});

export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>;

export const LeaderboardSchema = z.object({
  top: z.array(LeaderboardRowSchema),
  /** The asking player's row; `null` when they have no point in this game. */
  you: LeaderboardRowSchema.nullable(),
});

export type Leaderboard = z.infer<typeof LeaderboardSchema>;
