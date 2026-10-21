import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { WordGameView } from '@/components/word-game/word-game-view';
import { lastPageIfPastEnd } from '@/lib/chatbot/last-page';
import { getWordGame } from '@/lib/word-game/get-word-game';
import { parseWordsQuery, wordsQueryString } from '@/lib/word-game/words-query';

type WordGameProps = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-word-game');
  return { title: t('title') };
}

export default async function WordGamePage({ params, searchParams }: WordGameProps) {
  const { guildId } = await params;
  const query = parseWordsQuery(await searchParams);
  const { info, words } = await getWordGame(guildId, query);
  // A reset or a shorter list leaves a remembered link past the end; show the last page that exists.
  const last = lastPageIfPastEnd(words);
  if (last !== undefined) {
    redirect(`/servers/${guildId}/modules/word-game?${wordsQueryString({ ...query, page: last })}`);
  }

  return <WordGameView guildId={guildId} info={info} words={words} query={query} />;
}
