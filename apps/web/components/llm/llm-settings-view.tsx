'use client';

import { useTranslations } from 'next-intl';
import type { LlmSettings } from '@sab/shared';
import { Heading } from '@/components/ui/heading';
import { PageState } from '@/components/ui/page-state';
import { LlmSettingsForm } from './llm-settings-form';

interface LlmSettingsViewProps {
  guildId: string;
  guildName: string;
  settings: LlmSettings;
}

export function LlmSettingsView({ guildId, guildName, settings }: LlmSettingsViewProps) {
  const t = useTranslations('web-settings');
  const back = `/servers/${guildId}/settings`;

  if (!settings.adminServer) {
    return (
      <PageState
        status="info"
        title={t('llm.page.adminOnly')}
        body={t('llm.page.adminOnlyBody')}
        action={{ label: t('llm.page.back'), href: back }}
      />
    );
  }

  return (
    <>
      <Heading title={t('llm.page.title')} subtitle={`${t('llm.page.subtitle')} (${guildName})`} />
      <div style={{ maxWidth: 720 }}>
        {/* Remounted when the stored values change, so the form starts from what the server now holds. */}
        <LlmSettingsForm key={JSON.stringify(settings)} guildId={guildId} settings={settings} />
      </div>
    </>
  );
}
