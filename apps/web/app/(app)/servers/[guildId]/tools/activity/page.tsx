import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ActivityTool } from '@/components/tools/activity/activity-tool';

type ToolParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-tools');
  return { title: t('tools.activity.name') };
}

// The server layout has already turned an unknown server into the 404, and the
// tool reads nothing on the server, so the page only hands over the id.
export default async function ActivityToolPage({ params }: ToolParams) {
  const { guildId } = await params;
  return <ActivityTool guildId={guildId} />;
}
