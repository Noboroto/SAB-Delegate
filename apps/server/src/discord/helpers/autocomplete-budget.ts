import { Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import type { AutocompleteInterceptor } from 'necord';
import { isDeadInteractionError } from './reply.js';

/**
 * The interaction type Necord's autocomplete interceptor hands out. Derived,
 * not imported from discord.js: under CommonJS the compiler sees two separate
 * declarations of that class and refuses to assign one to the other.
 */
export type AutocompleteInteraction = Parameters<AutocompleteInterceptor['transformOptions']>[0];

type AutocompleteChoice = { name: string; value: string | number };

/** Discord shows at most this many suggestions and rejects more. */
export const AUTOCOMPLETE_MAX_CHOICES = 25;
/** Discord drops an autocomplete that is not answered within 3 s; stop earlier. */
const AUTOCOMPLETE_BUDGET_MS = 2000;
const AUTOCOMPLETE_CACHE_TTL_MS = 30_000;
const AUTOCOMPLETE_CACHE_MAX = 500;

type AutocompleteBudgetOptions<Data extends NonNullable<unknown>> = {
  /** Identifies the data to reuse across keystrokes; `undefined` disables the cache. */
  cacheKey(interaction: AutocompleteInteraction): string | undefined;
  /** The slow part (Discord calls, database reads). Cached per key. */
  load(interaction: AutocompleteInteraction): Promise<Data>;
  /** The cheap part: turn the data into suggestions for what is typed so far. */
  choices(data: Data, interaction: AutocompleteInteraction): AutocompleteChoice[];
  budgetMs?: number;
  ttlMs?: number;
};

const OVER_BUDGET = Symbol('over budget');

const logger = new Logger('AutocompleteBudget');

/**
 * Wraps an autocomplete handler so it always answers inside Discord's window.
 *
 * Autocomplete cannot be deferred and "Loading options failed" is all the user
 * sees when the answer is late. The slow `load` therefore gets a budget; past
 * it the user gets an empty list and `load` keeps running so the next keystroke
 * finds its result in the cache. Results are cached per key for 30 s, so typing
 * more characters filters locally instead of asking Discord again.
 *
 * A load still running for a key is shared by the keystrokes that arrive
 * meanwhile (typing fast would otherwise start one Discord fetch per
 * character, each slower than the last), and only a load that succeeded is
 * cached: a failure is retried by the next keystroke.
 *
 * An interaction that died while we worked (10062/40060) is only logged:
 * nobody is left to answer and a second reply cannot succeed. Any other error
 * from `load` propagates to the exception filter.
 */
export function withAutocompleteBudget<Data extends NonNullable<unknown>>(
  options: AutocompleteBudgetOptions<Data>,
): (interaction: AutocompleteInteraction) => Promise<void> {
  const budgetMs = options.budgetMs ?? AUTOCOMPLETE_BUDGET_MS;
  const cache = new LRUCache<string, Data>({
    max: AUTOCOMPLETE_CACHE_MAX,
    ttl: options.ttlMs ?? AUTOCOMPLETE_CACHE_TTL_MS,
  });

  const inFlight = new Map<string, Promise<Data>>();

  function load(key: string | undefined, interaction: AutocompleteInteraction): Promise<Data> {
    const running = key === undefined ? undefined : inFlight.get(key);
    if (running !== undefined) return running;

    // The cache is written inside the chain, before the entry leaves
    // `inFlight`, so there is no instant at which neither holds the data.
    const loading = (async () => options.load(interaction))().then((data) => {
      if (key !== undefined) cache.set(key, data);
      return data;
    });
    if (key !== undefined) {
      inFlight.set(key, loading);
      const release = (): void => {
        if (inFlight.get(key) === loading) inFlight.delete(key);
      };
      void loading.then(release, release);
    }
    return loading;
  }

  return async (interaction) => {
    const key = options.cacheKey(interaction);
    const cached = key === undefined ? undefined : cache.get(key);

    let choices: AutocompleteChoice[];
    if (cached !== undefined) {
      choices = options.choices(cached, interaction);
    } else {
      const loading = load(key, interaction);
      const outcome = await withinBudget(loading, budgetMs);
      choices = outcome === OVER_BUDGET ? [] : options.choices(outcome, interaction);
    }

    try {
      await interaction.respond(choices.slice(0, AUTOCOMPLETE_MAX_CHOICES));
    } catch (error) {
      if (!isDeadInteractionError(error)) throw error;
      logger.warn('Autocomplete expired before it could be answered');
    }
  };
}

async function withinBudget<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<T | typeof OVER_BUDGET> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<typeof OVER_BUDGET>((resolve) => {
    timer = setTimeout(() => resolve(OVER_BUDGET), budgetMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
    // If the budget won, `work` is still running; its eventual failure has no
    // caller to go to and must not become an unhandled rejection.
    work.catch(() => undefined);
  }
}
