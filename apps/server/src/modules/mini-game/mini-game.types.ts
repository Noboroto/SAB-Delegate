import type { Prisma } from '@prisma/client';
import { ErrorCode, GameMoveInputSchema, SnowflakeSchema, type GameMoveInput } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';

/** What a new round puts in the channel; `previous` is the answer it replaced. */
export type Opening =
  | { game: 'COUNTING' }
  | {
      game: 'SCRAMBLE';
      answer: string;
      letters: string;
      previous: string | null;
      /** Meaning of `previous`, when one is known. */
      previousMeaning: string | null;
    }
  | { game: 'WORDLE'; previous: string | null };

export type ScrambleOpening = Extract<Opening, { game: 'SCRAMBLE' }>;

export type CountingOutcome =
  | { status: 'NOTHING' }
  | { status: 'COUNTED'; count: number }
  | { status: 'WRONG_NUMBER'; expected: number; best: number }
  | { status: 'SAME_USER'; best: number };

export type ScrambleOutcome =
  | { status: 'NOTHING' }
  /**
   * As many letters as the answer, but not a listed word made of its letters.
   * `hint` comes with the wrong guess that reaches `SCRAMBLE_HINT_AFTER`.
   */
  | { status: 'WRONG'; hint?: { pattern: string; meaning: string | null } }
  | { status: 'SOLVED'; guess: string; meaning: string | null; next: ScrambleOpening };

export type WordleOutcome =
  | { status: 'NOTHING' | 'NOT_IN_LIST' | 'SAME_USER' | 'ALREADY_GUESSED' }
  /** `guesses` is the board after this guess; `answer` only scores it. */
  | { status: 'GUESSED' | 'SOLVED' | 'LOST'; guesses: string[]; answer: string };

/** The transaction client a game writes its round with. */
export type GameTx = Prisma.TransactionClient;

/**
 * A move that loses the compare-and-swap is judged again against the round the
 * winner left. Each loss means another move was accepted, so a handful of
 * rounds is far more than a channel can produce between two reads.
 */
export const MAX_ATTEMPTS = 16;

/** The wrong guess at one scramble puzzle that brings its hint. */
export const SCRAMBLE_HINT_AFTER = 10;

/** Validates what the listener hands over; the server id must be a snowflake. */
export function parseMove(guildId: string, input: unknown): { id: string; move: GameMoveInput } {
  const id = SnowflakeSchema.safeParse(guildId);
  const move = GameMoveInputSchema.safeParse(input);
  if (!id.success || !move.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return { id: id.data, move: move.data };
}
