import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ToolsIndex } from '@/components/tools/tools-index';

type ToolsParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-tools');
  return { title: t('index.title') };
}

// The server layout has already turned an unknown server into the 404.
export default async function ToolsPage({ params }: ToolsParams) {
  const { guildId } = await params;
  return <ToolsIndex guildId={guildId} />;
}
