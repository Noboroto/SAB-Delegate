import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ReauthState } from '@/components/auth/reauth-state';
import { LlmSettingsView } from '@/components/llm/llm-settings-view';
import { getGuildsOrReauth } from '@/lib/guilds';
import { getLlmSettings } from '@/lib/llm/get-llm-settings';
import { notFound } from 'next/navigation';

type GuildParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-settings');
  return { title: t('llm.page.title') };
}

export default async function LlmSettingsPage({ params }: GuildParams) {
  const { guildId } = await params;
  const guilds = await getGuildsOrReauth();
  if (guilds === null) return <ReauthState />;
  const guild = guilds.find((candidate) => candidate.id === guildId && candidate.botPresent);
  if (guild === undefined) notFound();

  const settings = await getLlmSettings(guild.id);
  return <LlmSettingsView guildId={guild.id} guildName={guild.name} settings={settings} />;
}
