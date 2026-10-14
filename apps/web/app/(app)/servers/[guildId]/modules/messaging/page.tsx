import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MessagingView } from '@/components/messaging/messaging-view';
import { parseMessagingTab } from '@/lib/messaging/tabs';

type MessagingProps = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-messaging');
  return { title: t('title') };
}

export default async function MessagingPage({ params, searchParams }: MessagingProps) {
  const { guildId } = await params;
  const { tab } = await searchParams;

  return <MessagingView guildId={guildId} initialTab={parseMessagingTab(tab)} />;
}
