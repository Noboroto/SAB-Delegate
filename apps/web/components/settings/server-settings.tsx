'use client';

import { Card, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { BotProfile, GuildSettings } from '@sab/shared';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { LinkButton } from '@/components/ui/link-button';
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
      <FormColumn>
        {/* Remounted when the stored values change, so the form starts from what the server now holds. */}
        <SettingsForm key={JSON.stringify(settings)} guildId={guildId} settings={settings} />
        {botProfile === undefined ? (
          <BotProfileUnavailable />
        ) : (
          <BotProfileForm guildId={guildId} profile={botProfile} />
        )}
        <Card title={t('llm.link.title')}>
          <Typography.Paragraph>{t('llm.link.description')}</Typography.Paragraph>
          <LinkButton href={`/servers/${guildId}/settings/llm`}>{t('llm.link.open')}</LinkButton>
        </Card>
      </FormColumn>
    </>
  );
}
