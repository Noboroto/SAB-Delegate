import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WordGameView } from '@/components/word-game/word-game-view';
import { getWordGame } from '@/lib/word-game/get-word-game';
import { parseWordsQuery } from '@/lib/word-game/words-query';

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

  return <WordGameView guildId={guildId} info={info} words={words} query={query} />;
}
