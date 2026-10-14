import {
  WordGameInfoSchema,
  WordGameWordsPageSchema,
  type WordGameInfo,
  type WordGameWordsPage,
  type WordGameWordsQuery,
} from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { wordsQueryString } from './words-query';
import { guildApiPath } from '@/lib/guild-path';

/** The round's state and one page of used words, read together so the page shows one moment. */
export async function getWordGame(
  guildId: string,
  query: WordGameWordsQuery,
): Promise<{ info: WordGameInfo; words: WordGameWordsPage }> {
  const base = guildApiPath(guildId, 'word-game');
  const [info, words] = await Promise.all([
    serverFetch(base, { parser: WordGameInfoSchema }),
    serverFetch(`${base}/words?${wordsQueryString(query)}`, { parser: WordGameWordsPageSchema }),
  ]);
  return { info, words };
}
