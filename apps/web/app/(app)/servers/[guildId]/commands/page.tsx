import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { CommandCatalog } from '@/components/commands/command-catalog';
import { getCommands } from '@/lib/commands/get-commands';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/lib/locale';

type CommandsParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-commands');
  return { title: t('title') };
}

export default async function CommandsPage({ params }: CommandsParams) {
  const { guildId } = await params;
  const current = await getLocale();
  const locale = isSupportedLocale(current) ? current : DEFAULT_LOCALE;
  const commands = await getCommands(guildId, locale);
  return <CommandCatalog commands={commands} />;
}
