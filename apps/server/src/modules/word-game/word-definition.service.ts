import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { z } from '@sab/shared';
import { LRUCache } from 'lru-cache';
import { errorLabel } from '../../prisma/pool-factory.js';
import {
  fetchDatamuse,
  fetchEnglishWiktionary,
  fetchVietnameseWiktionary,
  translateToVietnamese,
  EnglishSenseSchema,
  type DefinitionFetch,
  type VietnameseSense,
} from './word-definition.sources.js';

/** How the sources are reached; tests hand in a fake. */
export const DEFINITION_FETCH = Symbol('DEFINITION_FETCH');

/**
 * What the reply shows about a word. Each part is optional: a source that has
 * nothing or fails leaves its part out. `vietnameseSource` says whether the
 * meaning comes from Wiktionary or from a machine translation of `english`.
 */
const WordDefinitionSchema = z.object({
  english: EnglishSenseSchema.extend({ source: z.enum(['wiktionary', 'datamuse']) }).optional(),
  vietnamese: z
    .object({ meaning: z.string().min(1), source: z.enum(['wiktionary', 'machine']) })
    .optional(),
});
export type WordDefinition = z.infer<typeof WordDefinitionSchema>;

/** Popular words come back often in a game; a few thousand entries cost a few MB. */
const CACHE_MAX = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A result some source failed to contribute to is kept briefly, then asked again. */
const PARTIAL_TTL_MS = 10 * 60 * 1000;
/**
 * The anonymous translation quota is a few thousand characters a day; once it
 * refuses, asking again for every new word only adds a timeout to each reply.
 */
const TRANSLATION_PAUSE_MS = 60 * 60 * 1000;

/** The Vietnamese sense for the English part of speech, else the first one. */
function pickVietnamese(
  senses: readonly VietnameseSense[],
  partOfSpeech: string | undefined,
): VietnameseSense | undefined {
  return senses.find((sense) => sense.partOfSpeech === partOfSpeech) ?? senses[0];
}

/**
 * The meaning of an accepted word, for the reply under it. Kept in memory only
 * (the server has no disk to spare); the game itself never waits on it or
 * depends on it: judging uses the bundled word list and the used-words table.
 *
 * Never throws. A complete lookup, misses included, is cached for a day, which
 * also keeps the free translation quota for new words. A lookup in which a
 * source failed is cached for minutes if it found something, and not at all if
 * it found nothing, so the word is asked again soon.
 */
@Injectable()
export class WordDefinitionService {
  private readonly logger = new Logger(WordDefinitionService.name);
  private readonly cache: LRUCache<string, WordDefinition>;
  private translationPausedUntil = 0;

  constructor(
    @Optional()
    @Inject(DEFINITION_FETCH)
    private readonly fetcher: DefinitionFetch = (url, init) => fetch(url, init),
  ) {
    this.cache = new LRUCache<string, WordDefinition>({
      max: CACHE_MAX,
      ttl: CACHE_TTL_MS,
      // lru-cache binds the global clock once, at import; reading it per call is
      // still monotonic and lets a replaced clock (fake timers) take effect.
      perf: { now: () => performance.now() },
      // Concurrent lookups of one word share a single set of requests.
      fetchMethod: async (word, _stale, { options }) => {
        const found = await this.lookup(word);
        if (found?.partial === true) options.ttl = PARTIAL_TTL_MS;
        return found?.definition;
      },
    });
  }

  /** `word` must already be lower-case. `null` when there is nothing to show. */
  async define(word: string): Promise<WordDefinition | null> {
    try {
      const found = await this.cache.fetch(word);
      if (found === undefined || (found.english === undefined && found.vietnamese === undefined)) {
        return null;
      }
      return found;
    } catch (error) {
      this.logger.warn(`Word definition lookup failed (${errorLabel(error)})`);
      return null;
    }
  }

  /**
   * `undefined` means "do not cache": a source failed and nothing was found.
   * `partial` means a source failed but something was found.
   */
  private async lookup(
    word: string,
  ): Promise<{ definition: WordDefinition; partial: boolean } | undefined> {
    let failed = false;
    const attempt = async <T>(source: string, run: () => Promise<T | null>) => {
      try {
        return await run();
      } catch (error) {
        failed = true;
        this.logger.warn(`Dictionary source ${source} failed (${errorLabel(error)})`);
        return null;
      }
    };

    const [wiktionary, viSenses] = await Promise.all([
      attempt('en.wiktionary', () => fetchEnglishWiktionary(this.fetcher, word)),
      attempt('vi.wiktionary', () => fetchVietnameseWiktionary(this.fetcher, word)),
    ]);
    const english: WordDefinition['english'] =
      wiktionary === null
        ? await attempt('datamuse', () => fetchDatamuse(this.fetcher, word)).then((sense) =>
            sense === null ? undefined : { ...sense, source: 'datamuse' as const },
          )
        : { ...wiktionary, source: 'wiktionary' };

    let vietnamese: WordDefinition['vietnamese'];
    const human = viSenses === null ? undefined : pickVietnamese(viSenses, english?.partOfSpeech);
    if (human !== undefined) {
      vietnamese = { meaning: human.meaning, source: 'wiktionary' };
    } else if (english !== undefined) {
      const translated = await this.translate(english.definition);
      if (translated === null) failed = true;
      else vietnamese = translated;
    }

    if (english === undefined && vietnamese === undefined && failed) return undefined;
    return {
      definition: WordDefinitionSchema.parse({
        ...(english === undefined ? {} : { english }),
        ...(vietnamese === undefined ? {} : { vietnamese }),
      }),
      partial: failed,
    };
  }

  /** `null` when paused or refused (worth asking later), `undefined` when empty. */
  private async translate(text: string): Promise<WordDefinition['vietnamese'] | null> {
    if (Date.now() < this.translationPausedUntil) return null;
    try {
      const translated = await translateToVietnamese(this.fetcher, text);
      return translated === null ? undefined : { meaning: translated, source: 'machine' };
    } catch (error) {
      this.translationPausedUntil = Date.now() + TRANSLATION_PAUSE_MS;
      this.logger.warn(`Translation paused for an hour (${errorLabel(error)})`);
      return null;
    }
  }
}
