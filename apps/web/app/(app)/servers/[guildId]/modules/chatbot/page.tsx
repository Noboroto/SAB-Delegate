import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChatbotView } from '@/components/chatbot/chatbot-view';
import { getChatbotConfig, getChatbotQuota, getChatbotTurns } from '@/lib/chatbot/get-chatbot';
import { lastPageIfPastEnd } from '@/lib/chatbot/last-page';
import { parseQuotaQuery, quotaQueryString } from '@/lib/chatbot/quota-query';
import { parseChatbotTab } from '@/lib/chatbot/tabs';
import { parseTurnsQuery, turnsQueryString } from '@/lib/chatbot/turns-query';
import { getLlmSettings } from '@/lib/llm/get-llm-settings';

type ChatbotProps = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-chatbot');
  return { title: t('title') };
}

export default async function ChatbotPage({ params, searchParams }: ChatbotProps) {
  const { guildId } = await params;
  const query = await searchParams;
  const tab = parseChatbotTab(query['tab']);
  const here = `/servers/${guildId}/modules/chatbot`;

  if (tab === 'usage') {
    const quotaQuery = parseQuotaQuery(query);
    const [config, quota] = await Promise.all([
      getChatbotConfig(guildId),
      getChatbotQuota(guildId, quotaQuery),
    ]);
    const last = lastPageIfPastEnd(quota);
    if (last !== undefined) {
      redirect(`${here}?tab=usage&${quotaQueryString({ ...quotaQuery, page: last })}`);
    }
    return (
      <ChatbotView guildId={guildId} config={config} tab="usage" quota={quota} query={quotaQuery} />
    );
  }
  if (tab === 'history') {
    const turnsQuery = parseTurnsQuery(query);
    const [config, turns] = await Promise.all([
      getChatbotConfig(guildId),
      getChatbotTurns(guildId, turnsQuery),
    ]);
    const last = lastPageIfPastEnd(turns);
    if (last !== undefined) {
      redirect(`${here}?tab=history&${turnsQueryString({ ...turnsQuery, page: last })}`);
    }
    return (
      <ChatbotView
        guildId={guildId}
        config={config}
        tab="history"
        turns={turns}
        query={turnsQuery}
      />
    );
  }
  // The shared model's page exists in the admin server only; the settings read says which one this is.
  const [config, llm] = await Promise.all([getChatbotConfig(guildId), getLlmSettings(guildId)]);
  return (
    <ChatbotView guildId={guildId} config={config} tab="settings" adminServer={llm.adminServer} />
  );
}
