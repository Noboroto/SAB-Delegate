import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where the words come from; the default reads the bundled asset. */
export const DICTIONARY_SOURCE = Symbol('DICTIONARY_SOURCE');

export type DictionarySource = () => Promise<readonly string[]>;

const ASSET_NAME = 'word-dict.json';

/**
 * The asset sits at `apps/server/assets` next to `src` (specs, `tsx`) and is
 * copied to `dist/assets` by the build (`nest-cli.json` assets), which is the
 * only place it exists in the production image. Both are reached from this
 * file's directory, which is three levels below the package in `src` and in
 * `dist` alike.
 */
const ASSET_CANDIDATES: readonly string[] = [
  join(__dirname, '..', '..', '..', 'assets', ASSET_NAME),
  join(__dirname, '..', '..', 'assets', ASSET_NAME),
];

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readAsset(): Promise<string> {
  for (const path of ASSET_CANDIDATES) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  throw new Error(`Dictionary asset ${ASSET_NAME} not found next to the build`);
}

/** The asset is an object with one key per word; the values carry nothing. */
export async function loadBundledWords(): Promise<readonly string[]> {
  const parsed: unknown = JSON.parse(await readAsset());
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Dictionary asset ${ASSET_NAME} is not an object of words`);
  }
  return Object.keys(parsed);
}

/**
 * The word list of the game, 370,100 words. Read on first use rather than at
 * boot, so a server that never hosts a game does not pay for it, and kept as a
 * `Set`: an object lookup would answer `true` for "constructor" or "__proto__".
 */
@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);
  private words: Promise<ReadonlySet<string>> | undefined;

  constructor(
    @Optional()
    @Inject(DICTIONARY_SOURCE)
    private readonly source: DictionarySource = loadBundledWords,
  ) {}

  /** `word` must already be lower-case and trimmed. */
  async has(word: string): Promise<boolean> {
    return (await this.load()).has(word);
  }

  /**
   * One load is shared by every caller that arrives while it runs. A failed
   * load is dropped, so the next message tries again instead of the game being
   * dead until the next deploy.
   */
  private load(): Promise<ReadonlySet<string>> {
    this.words ??= this.source()
      .then((list) => new Set(list))
      .catch((error: unknown) => {
        this.words = undefined;
        this.logger.warn('Dictionary load failed; it is retried on the next word');
        throw error;
      });
    return this.words;
  }
}
