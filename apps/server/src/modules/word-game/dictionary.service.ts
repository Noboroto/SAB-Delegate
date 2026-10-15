import { Inject, Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where the words come from; the default reads the bundled asset. */
export const DICTIONARY_SOURCE = Symbol('DICTIONARY_SOURCE');

export type DictionarySource = () => Promise<readonly string[]>;

const ASSET_NAME = 'word-dict.json';

/**
 * The assets sit at `apps/server/assets` next to `src` (specs, `tsx`) and are
 * copied to `dist/assets` by the build (`nest-cli.json` assets), which is the
 * only place they exist in the production image. Both are reached from this
 * file's directory, which is three levels below the package in `src` and in
 * `dist` alike.
 */
function assetCandidates(name: string): readonly string[] {
  return [
    join(__dirname, '..', '..', '..', 'assets', name),
    join(__dirname, '..', '..', 'assets', name),
  ];
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The text of a bundled asset of the server, such as a word list. */
export async function readAsset(name: string): Promise<string> {
  for (const path of assetCandidates(name)) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  throw new Error(`Asset ${name} not found next to the build`);
}

/** The asset is an object with one key per word; the values carry nothing. */
export async function loadBundledWords(): Promise<readonly string[]> {
  const parsed: unknown = JSON.parse(await readAsset(ASSET_NAME));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Dictionary asset ${ASSET_NAME} is not an object of words`);
  }
  return Object.keys(parsed);
}

/**
 * The word list of the game, 370,100 words, kept as a `Set`: an object lookup
 * would answer `true` for "constructor" or "__proto__".
 *
 * Building it blocks the event loop for about 200 ms (JSON.parse, then the
 * keys, then the `Set`; measured on Node 24), so it starts at boot, before
 * anyone plays, rather than on the first word of a game.
 */
@Injectable()
export class DictionaryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DictionaryService.name);
  private words: Promise<ReadonlySet<string>> | undefined;

  constructor(
    @Optional()
    @Inject(DICTIONARY_SOURCE)
    private readonly source: DictionarySource = loadBundledWords,
  ) {}

  /**
   * Not awaited: boot must not wait on, or fail because of, the word list. A
   * failed load is logged by `load` and retried on the first word.
   */
  onApplicationBootstrap(): void {
    this.load().catch(() => undefined);
  }

  /** `word` must already be lower-case. */
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
