'use client';

import { useState } from 'react';
import { App, Button, Card, Form, InputNumber, Switch, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CHATBOT_LIMIT_MAX, type ChatbotConfig } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { configureChatbot } from '@/lib/chatbot/chatbot-api';

const LIMIT_STEP = 1000;

/** The switch and the monthly limit a member gets when the server sets none of their own. */
export function ChatbotSettingsCard({
  guildId,
  config,
}: {
  guildId: string;
  config: Pick<ChatbotConfig, 'enabled' | 'defaultMonthlyLimit'>;
}) {
  const t = useTranslations('web-chatbot');
  const { message } = App.useApp();
  const router = useRouter();
  const [limit, setLimit] = useState<number | null>(config.defaultMonthlyLimit);
  // An edit in progress survives other saves (the switch); only a new saved limit replaces it.
  const [savedLimit, setSavedLimit] = useState(config.defaultMonthlyLimit);
  if (savedLimit !== config.defaultMonthlyLimit) {
    setSavedLimit(config.defaultMonthlyLimit);
    setLimit(config.defaultMonthlyLimit);
  }

  const save = useApiMutation((patch: Parameters<typeof configureChatbot>[1]) =>
    configureChatbot(guildId, patch),
  );

  // A cleared input is `null`; a half-typed number outside the bounds is the server's 400 otherwise.
  const limitInvalid =
    limit === null || !Number.isInteger(limit) || limit < 0 || limit > CHATBOT_LIMIT_MAX;
  const limitChanged = limit !== config.defaultMonthlyLimit;

  const toggle = async (enabled: boolean) => {
    const outcome = await save.run({ enabled });
    if (outcome?.ok !== true) return;
    void message.success(enabled ? t('settings.turnedOn') : t('settings.turnedOff'));
    router.refresh();
  };

  const saveLimit = async () => {
    // Enter in the field submits the form too.
    if (limitInvalid || !limitChanged) return;
    const outcome = await save.run({ defaultMonthlyLimit: limit });
    if (outcome?.ok !== true) return;
    void message.success(t('settings.limitSaved'));
    router.refresh();
  };

  return (
    <Card title={t('settings.title')}>
      <Typography.Paragraph type="secondary">{t('settings.intro')}</Typography.Paragraph>
      <Form layout="vertical" onFinish={() => void saveLimit()}>
        <Form.Item label={t('settings.enabled')} htmlFor="chatbot-enabled">
          <Switch
            id="chatbot-enabled"
            checked={config.enabled}
            loading={save.pending}
            disabled={save.pending}
            onChange={(next) => void toggle(next)}
          />
        </Form.Item>
        <Form.Item
          label={t('settings.defaultLimit')}
          htmlFor="chatbot-default-limit"
          extra={t('settings.defaultLimitHelp', { max: CHATBOT_LIMIT_MAX })}
          validateStatus={limitInvalid ? 'error' : undefined}
        >
          <InputNumber
            id="chatbot-default-limit"
            min={0}
            max={CHATBOT_LIMIT_MAX}
            step={LIMIT_STEP}
            precision={0}
            value={limit}
            onChange={setLimit}
            style={{ width: '100%' }}
          />
        </Form.Item>
        {save.error === undefined ? null : (
          <Form.Item>
            <ErrorAlert error={save.error} />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <ActionRow>
            <Button
              type="primary"
              htmlType="submit"
              loading={save.pending}
              disabled={!limitChanged || limitInvalid}
            >
              {t('settings.save')}
            </Button>
          </ActionRow>
        </Form.Item>
      </Form>
    </Card>
  );
}
