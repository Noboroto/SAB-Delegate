import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GamesGuide } from '@/components/games/games-guide';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('servers.nav');
  return { title: t('games') };
}

/** How each game is played and set up; the games themselves are set up in Discord. */
export default function GamesPage() {
  return <GamesGuide />;
}
