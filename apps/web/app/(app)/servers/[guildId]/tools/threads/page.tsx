import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ThreadsTool } from '@/components/tools/threads/threads-tool';
import { parseThreadsTab } from '@/lib/tools/threads-tabs';

type ToolParams = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-tools');
  return { title: t('tools.threads.name') };
}

// The server layout has already turned an unknown server into the 404, and the
// tool reads nothing on the server, so the page only hands over the id and the
// tab named in the address.
export default async function ThreadsToolPage({ params, searchParams }: ToolParams) {
  const { guildId } = await params;
  const { tab } = await searchParams;
  return <ThreadsTool guildId={guildId} initialTab={parseThreadsTab(tab)} />;
}
