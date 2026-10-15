import { WORDLE_MAX_GUESSES, WORDLE_WORD_LENGTH } from '@sab/shared';
import type { APIEmbed, BaseMessageOptions } from 'discord.js';
import type { translatorFor } from '../../i18n/translator.js';
import type { Opening, ScrambleOpening, WordleOutcome } from './mini-game.types.js';
import { syllableCount } from './vietnamese.js';
import { renderBoard } from './wordle-score.js';

type T = ReturnType<typeof translatorFor>;

/** A message the games post: text, embeds or both. */
export type GamePost = Pick<BaseMessageOptions, 'content' | 'embeds'>;

/** Discord's brand colours. */
const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;
const YELLOW = 0xfee75c;
const RED = 0xed4245;

/** What a new round posts in its channel. */
export function formatOpening(t: T, opening: Opening): GamePost {
  switch (opening.game) {
    case 'COUNTING':
      return { content: t('mini-game.counting.start') };
    case 'SCRAMBLE':
      return { embeds: [scramblePuzzle(t, opening)] };
    case 'WORDLE':
      return {
        embeds: [
          {
            title: 'Wordle',
            color: BLURPLE,
            description: t('mini-game.wordle.start', {
              length: String(WORDLE_WORD_LENGTH),
              max: String(WORDLE_MAX_GUESSES),
            }),
          },
        ],
      };
  }
}

function scramblePuzzle(t: T, opening: ScrambleOpening): APIEmbed {
  return {
    title: t('mini-game.scramble.title'),
    color: YELLOW,
    description: `${t('mini-game.scramble.prompt')}\n\n**${opening.letters}**`,
    footer: {
      text: t('mini-game.scramble.syllables', { count: String(syllableCount(opening.answer)) }),
    },
  };
}

/** The win, then the next puzzle; a mention inside an embed never notifies. */
export function formatScrambleSolved(
  t: T,
  guess: string,
  authorId: string,
  next: ScrambleOpening,
): GamePost {
  return {
    embeds: [
      {
        color: GREEN,
        description: t('mini-game.scramble.solved', { user: `<@${authorId}>`, answer: guess }),
      },
      scramblePuzzle(t, next),
    ],
  };
}

/** A board still in play, a win and a loss. */
const WORDLE_COLORS = { GUESSED: BLURPLE, SOLVED: GREEN, LOST: RED } as const;

/**
 * The board after a guess that took a turn, as an embed: the squares line up
 * and stand apart from the chat. A mention inside an embed never notifies.
 */
export function formatWordleTurn(
  t: T,
  outcome: Extract<WordleOutcome, { guesses: string[] }>,
  authorId: string,
): APIEmbed {
  const count = String(outcome.guesses.length);
  const max = String(WORDLE_MAX_GUESSES);
  const answer = outcome.answer.toUpperCase();
  const verdict =
    outcome.status === 'SOLVED'
      ? t('mini-game.wordle.solved', { user: `<@${authorId}>`, answer, count, max })
      : outcome.status === 'LOST'
        ? t('mini-game.wordle.lost', { answer })
        : null;
  return {
    title: 'Wordle',
    color: WORDLE_COLORS[outcome.status],
    description: [renderBoard(outcome.guesses, outcome.answer), verdict]
      .filter((part) => part !== null)
      .join('\n\n'),
    footer: { text: t('mini-game.wordle.progress', { count, max }) },
  };
}
