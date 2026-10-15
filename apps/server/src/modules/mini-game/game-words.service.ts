import { Inject, Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { WORDLE_WORD_LENGTH } from '@sab/shared';
import { DictionaryService, readAsset } from '../word-game/dictionary.service.js';
import { compactWord } from './vietnamese.js';

/** Where the word lists come from; specs pass their own lists to the constructor. */
const GAME_WORDS_SOURCE = Symbol('GAME_WORDS_SOURCE');

/**
 * `vietnamese`: Vietnamese words of two or three syllables, one per entry.
 * `wordleAnswers`: common English words of `WORDLE_WORD_LENGTH` letters.
 */
export type GameWordsSource = Record<
  'vietnamese' | 'wordleAnswers',
  () => Promise<readonly string[]>
>;

async function readLines(name: string): Promise<readonly string[]> {
  return (await readAsset(name))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

const BUNDLED: GameWordsSource = {
  vietnamese: () => readLines('viet-words.txt'),
  wordleAnswers: () => readLines('wordle-answers.txt'),
};

type VietWords = { list: readonly string[]; compact: ReadonlySet<string> };
type WordleWords = { list: readonly string[]; set: ReadonlySet<string> };

const WORDLE_WORD = new RegExp(`^[a-z]{${WORDLE_WORD_LENGTH}}$`, 'u');

/**
 * One load shared by every caller that arrives while it runs. A failed load is
 * dropped, so the next move tries again instead of the game being dead until
 * the next deploy.
 */
class Lazy<T> {
  private value: Promise<T> | undefined;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly onError: () => void,
  ) {}

  get(): Promise<T> {
    this.value ??= this.load().catch((error: unknown) => {
      this.value = undefined;
      this.onError();
      throw error;
    });
    return this.value;
  }
}

function pick<T>(list: readonly T[], random: () => number): T {
  if (list.length === 0) throw new Error('A word list is empty');
  return list[Math.floor(random() * list.length)] as T;
}

/**
 * The word lists of the scramble and Wordle. Loaded in the background at boot
 * so the first move does not wait on them; boot neither waits nor fails.
 * Wordle accepts as a guess any English word of the right length that the word
 * chain knows, and draws its answers from the shorter list of common words.
 */
@Injectable()
export class GameWordsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GameWordsService.name);
  private readonly viet: Lazy<VietWords>;
  private readonly wordle: Lazy<WordleWords>;

  constructor(
    private readonly dictionary: DictionaryService,
    @Optional()
    @Inject(GAME_WORDS_SOURCE)
    source: GameWordsSource = BUNDLED,
  ) {
    this.viet = new Lazy(
      async () => {
        const list = await source.vietnamese();
        return { list, compact: new Set(list.map(compactWord)) };
      },
      () => this.logger.warn('Vietnamese word list load failed; it is retried on the next move'),
    );
    this.wordle = new Lazy(
      async () => {
        const list = (await source.wordleAnswers()).filter((word) => WORDLE_WORD.test(word));
        return { list, set: new Set(list) };
      },
      () => this.logger.warn('Wordle word list load failed; it is retried on the next move'),
    );
  }

  onApplicationBootstrap(): void {
    this.viet.get().catch(() => undefined);
    this.wordle.get().catch(() => undefined);
  }

  /** Whatever its spacing, case or tone placement. */
  async isVietnameseWord(text: string): Promise<boolean> {
    return (await this.viet.get()).compact.has(compactWord(text));
  }

  async pickVietnamese(random: () => number = Math.random): Promise<string> {
    return pick((await this.viet.get()).list, random);
  }

  /** `word` must already be lower case. */
  async isWordleGuess(word: string): Promise<boolean> {
    if (!WORDLE_WORD.test(word)) return false;
    return (await this.wordle.get()).set.has(word) || (await this.dictionary.has(word));
  }

  async pickWordleAnswer(random: () => number = Math.random): Promise<string> {
    return pick((await this.wordle.get()).list, random);
  }
}
