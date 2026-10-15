import { WORDLE_MAX_GUESSES, WORDLE_WORD_LENGTH } from '@sab/shared';
import { escapeMarkdown, type APIEmbed, type BaseMessageOptions } from 'discord.js';
import type { translatorFor } from '../../i18n/translator.js';
import {
  SCRAMBLE_HINT_AFTER,
  type Opening,
  type ScrambleOpening,
  type WordleOutcome,
} from './mini-game.types.js';
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
    case 'SCRAMBLE': {
      // A puzzle that replaces another (skip, reset) first reveals the old answer.
      const previous =
        opening.previous === null
          ? []
          : [
              revealed(
                t,
                t('mini-game.scramble.previous', { answer: opening.previous }),
                opening.previousMeaning,
                BLURPLE,
              ),
            ];
      return { embeds: [...previous, scramblePuzzle(t, opening)] };
    }
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

/**
 * Longest meaning shown. Escaping can at most double it, which stays under
 * Discord's 1024-character cap on an embed field value.
 */
const MEANING_MAX = 500;

/**
 * External text (Wiktionary, a dictionary, an LLM) shown as written, not as
 * markdown, and cut to what a field holds.
 */
function plain(text: string): string {
  // Cut by code point before escaping: no split emoji, no lone backslash at the end.
  const points = Array.from(text);
  const kept =
    points.length <= MEANING_MAX ? text : `${points.slice(0, MEANING_MAX).join('').trimEnd()}…`;
  return escapeMarkdown(kept, { maskedLink: true });
}

/** An answer made known, with its meaning under it when one is known. */
function revealed(t: T, description: string, meaning: string | null, color: number): APIEmbed {
  return {
    color,
    description,
    ...(meaning === null
      ? {}
      : { fields: [{ name: t('mini-game.scramble.meaning'), value: plain(meaning) }] }),
  };
}

/** The hint of a puzzle: its shape, and its meaning with the answer hidden. */
export function formatScrambleHint(
  t: T,
  hint: { pattern: string; meaning: string | null },
): GamePost {
  return {
    embeds: [
      {
        title: t('mini-game.scramble.hintTitle', { count: String(SCRAMBLE_HINT_AFTER) }),
        color: YELLOW,
        fields: [
          { name: t('mini-game.scramble.hintShape'), value: `\`${hint.pattern}\`` },
          ...(hint.meaning === null
            ? []
            : [{ name: t('mini-game.scramble.hintMeaning'), value: plain(hint.meaning) }]),
        ],
      },
    ],
  };
}

/** The win, then the next puzzle; a mention inside an embed never notifies. */
export function formatScrambleSolved(
  t: T,
  guess: string,
  meaning: string | null,
  authorId: string,
  next: ScrambleOpening,
): GamePost {
  return {
    embeds: [
      revealed(
        t,
        t('mini-game.scramble.solved', { user: `<@${authorId}>`, answer: guess }),
        meaning,
        GREEN,
      ),
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
