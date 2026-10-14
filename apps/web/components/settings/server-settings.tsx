'use client';

import { Space } from 'antd';
import { useTranslations } from 'next-intl';
import type { BotProfile, GuildSettings } from '@sab/shared';
import { Heading } from '@/components/ui/heading';
import { BotProfileForm } from './bot-profile-form';
import { BotProfileUnavailable } from './bot-profile-unavailable';
import { SettingsForm } from './settings-form';

interface ServerSettingsProps {
  guildId: string;
  guildName: string;
  settings: GuildSettings;
  /** `undefined` when the bot's name and picture could not be read. */
  botProfile: BotProfile | undefined;
}

/** The settings page: language and channels, then how the bot looks on this server. */
export function ServerSettings({ guildId, guildName, settings, botProfile }: ServerSettingsProps) {
  const t = useTranslations('web-settings');

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle', { guild: guildName })} />
      <Space orientation="vertical" size={16} style={{ display: 'flex', maxWidth: 720 }}>
        {/* Remounted when the stored values change, so the form starts from what the server now holds. */}
        <SettingsForm key={JSON.stringify(settings)} guildId={guildId} settings={settings} />
        {botProfile === undefined ? (
          <BotProfileUnavailable />
        ) : (
          <BotProfileForm guildId={guildId} profile={botProfile} />
        )}
      </Space>
    </>
  );
}
