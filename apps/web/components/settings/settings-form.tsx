'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Card, Form, InputNumber, Select, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  GuildSettingsSchema,
  WORD_MAX_WORDS_MAX,
  WORD_MAX_WORDS_MIN,
  type GuildSettings,
  type GuildSettingsPatch,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { useUnsavedChanges } from '@/components/forms/unsaved-guard';
import { apiFetch } from '@/lib/api/api-fetch';
import { useApiMutation } from '@/lib/api/mutations';
import { CHANNEL_TYPE, TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { diffSettings, toFormValues, type SettingsFormValues } from '@/lib/settings/settings-diff';
import { guildApiPath } from '@/lib/guild-path';

interface SettingsFormProps {
  guildId: string;
  settings: GuildSettings;
}

const CATEGORY_TYPES: readonly number[] = [CHANNEL_TYPE.category];

/**
 * The bot's language and channels. Only the fields that changed are sent, and
 * the page is re-read afterwards so the form shows what the server now holds.
 */
export function SettingsForm({ guildId, settings }: SettingsFormProps) {
  const t = useTranslations('web-settings');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<SettingsFormValues>();
  const values = Form.useWatch([], form) as SettingsFormValues | undefined;
  const patch = useMemo(
    () => diffSettings(settings, values ?? toFormValues(settings)),
    [settings, values],
  );
  // The `settings` prop a save succeeded against: until a refresh replaces it
  // the form still differs from it, and a second click would send the same PATCH.
  const [savedFor, setSavedFor] = useState<GuildSettings | undefined>(undefined);
  const awaitingRefresh = savedFor === settings;
  const changed = Object.keys(patch).length > 0 && !awaitingRefresh;
  useUnsavedChanges(changed);

  const save = useApiMutation((body: GuildSettingsPatch) =>
    apiFetch(guildApiPath(guildId, 'settings'), {
      method: 'PATCH',
      body,
      parser: GuildSettingsSchema,
    }),
  );

  const onFinish = async (submitted: SettingsFormValues) => {
    const body = diffSettings(settings, submitted);
    if (Object.keys(body).length === 0 || awaitingRefresh) return;
    const outcome = await save.run(body);
    if (outcome === undefined) return;
    if (outcome.ok) {
      void message.success(t('saved'));
      setSavedFor(settings);
      router.refresh();
    } else if (outcome.error.status === 0) {
      // No readable answer: the change may have been applied, so re-read the page.
      router.refresh();
    }
  };

  const channel = (name: keyof SettingsFormValues, label: string, types: readonly number[]) => (
    <Form.Item name={name} label={label}>
      <ChannelSelect guildId={guildId} types={types} allowClear disabled={save.pending} />
    </Form.Item>
  );

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={toFormValues(settings)}
      onFinish={(submitted) => void onFinish(submitted)}
      disabled={save.pending}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      <Card title={t('language.title')}>
        <Form.Item name="locale" label={t('language.label')} extra={t('language.description')}>
          <Select
            options={[
              { value: 'vi', label: t('language.vi') },
              { value: 'en', label: t('language.en') },
            ]}
          />
        </Form.Item>
      </Card>
      <Card title={t('channels.title')}>
        <Typography.Paragraph>{t('channels.description')}</Typography.Paragraph>
        {channel('introChannelId', t('channels.intro'), TEXT_CHANNEL_TYPES)}
        {channel('logChannelId', t('channels.log'), TEXT_CHANNEL_TYPES)}
        {channel('birthdayChannelId', t('channels.birthday'), TEXT_CHANNEL_TYPES)}
        {channel('wordChannelId', t('channels.word'), TEXT_CHANNEL_TYPES)}
        {channel('activityCategoryId', t('channels.activity'), CATEGORY_TYPES)}
        <Form.Item
          name="wordMaxWords"
          label={t('channels.wordMax')}
          extra={t('channels.wordMaxHelp', { min: WORD_MAX_WORDS_MIN })}
          rules={[{ type: 'number', min: WORD_MAX_WORDS_MIN, max: WORD_MAX_WORDS_MAX }]}
        >
          <InputNumber
            min={WORD_MAX_WORDS_MIN}
            max={WORD_MAX_WORDS_MAX}
            precision={0}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Card>
      {save.error === undefined ? null : <ErrorAlert error={save.error} />}
      <Form.Item style={{ marginBottom: 0 }}>
        <Button type="primary" htmlType="submit" loading={save.pending} disabled={!changed}>
          {t('save')}
        </Button>
      </Form.Item>
    </Form>
  );
}
