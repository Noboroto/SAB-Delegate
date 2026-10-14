import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ModulesIndex } from '@/components/modules/modules-index';

type ModulesParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('servers.nav');
  return { title: t('modules') };
}

export default async function ModulesPage({ params }: ModulesParams) {
  const { guildId } = await params;
  return <ModulesIndex guildId={guildId} />;
}
