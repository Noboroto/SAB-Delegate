'use client';

import { useState } from 'react';
import { App, Button, Form, InputNumber, Modal, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CHATBOT_LIMIT_MAX, formatTokenCount, type ChatbotQuotaRow } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { grantChatbotTokens, setChatbotLimit } from '@/lib/chatbot/chatbot-api';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';

const STEP = 1000;

interface QuotaModalProps {
  guildId: string;
  userId: string;
  /** What the member is called in the dialog: their name, or the id when the server does not know them. */
  name: string;
  /** The member's row when the table has it; a member with no usage yet has none. */
  row: ChatbotQuotaRow | undefined;
  onClose: () => void;
}

/** Sets the member's own monthly limit, or drops it so the server default applies again. */
export function SetLimitModal({
  guildId,
  userId,
  name,
  row,
  onClose,
  defaultLimit,
}: QuotaModalProps & { defaultLimit: number }) {
  const t = useTranslations('web-chatbot');
  const tCommon = useTranslations('web-common');
  const { message } = App.useApp();
  const router = useRouter();
  const locale = useUiLocale();
  const [value, setValue] = useState<number | null>(row?.overridden ? row.limit : defaultLimit);
  const save = useApiMutation((limit: number | null) => setChatbotLimit(guildId, userId, limit));

  const invalid =
    value === null || !Number.isInteger(value) || value < 0 || value > CHATBOT_LIMIT_MAX;

  const submit = async (limit: number | null) => {
    const outcome = await save.run(limit);
    if (outcome?.ok !== true) return;
    void message.success(limit === null ? t('usage.limitCleared') : t('usage.limitSaved'));
    onClose();
    router.refresh();
  };

  return (
    <Modal
      open
      title={t('usage.limitTitle')}
      onCancel={() => {
        if (!save.pending) onClose();
      }}
      destroyOnHidden
      footer={
        <ActionRow align="end">
          <Button disabled={save.pending} onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          {row?.overridden === false ? null : (
            <Button disabled={save.pending} onClick={() => void submit(null)}>
              {t('usage.limitUseDefault', { limit: formatTokenCount(defaultLimit, locale) })}
            </Button>
          )}
          <Button
            type="primary"
            loading={save.pending}
            disabled={invalid}
            onClick={() => void submit(value)}
          >
            {t('usage.limitSave')}
          </Button>
        </ActionRow>
      }
    >
      <Form layout="vertical" onFinish={() => (invalid ? undefined : void submit(value))}>
        <Typography.Paragraph>{t('usage.forMember', { name })}</Typography.Paragraph>
        <Form.Item
          label={t('usage.limitLabel')}
          htmlFor="chatbot-member-limit"
          extra={t('usage.limitHelp', { max: formatTokenCount(CHATBOT_LIMIT_MAX, locale) })}
          validateStatus={invalid ? 'error' : undefined}
        >
          <InputNumber
            id="chatbot-member-limit"
            min={0}
            max={CHATBOT_LIMIT_MAX}
            step={STEP}
            precision={0}
            value={value}
            onChange={setValue}
            style={{ width: '100%' }}
          />
        </Form.Item>
        {save.error === undefined ? null : <ErrorAlert error={save.error} />}
      </Form>
    </Modal>
  );
}

/** Adds tokens to, or takes tokens back from, this month's bonus of one member. */
export function GrantModal({ guildId, userId, name, onClose }: QuotaModalProps) {
  const t = useTranslations('web-chatbot');
  const tCommon = useTranslations('web-common');
  const { message } = App.useApp();
  const router = useRouter();
  const locale = useUiLocale();
  const [value, setValue] = useState<number | null>(null);
  const grant = useApiMutation((tokens: number) => grantChatbotTokens(guildId, userId, tokens));

  const invalid =
    value === null ||
    !Number.isInteger(value) ||
    value === 0 ||
    Math.abs(value) > CHATBOT_LIMIT_MAX;

  const submit = async () => {
    if (value === null || invalid) return;
    const outcome = await grant.run(value);
    if (outcome?.ok !== true) return;
    void message.success(t('usage.grantSaved'));
    onClose();
    router.refresh();
  };

  return (
    <Modal
      open
      title={t('usage.grantTitle')}
      onCancel={() => {
        if (!grant.pending) onClose();
      }}
      destroyOnHidden
      footer={
        <ActionRow align="end">
          <Button disabled={grant.pending} onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="primary"
            loading={grant.pending}
            disabled={invalid}
            onClick={() => void submit()}
          >
            {t('usage.grantSave')}
          </Button>
        </ActionRow>
      }
    >
      <Form layout="vertical" onFinish={() => void submit()}>
        <Typography.Paragraph>{t('usage.forMember', { name })}</Typography.Paragraph>
        <Form.Item
          label={t('usage.grantLabel')}
          htmlFor="chatbot-member-grant"
          extra={t('usage.grantHelp', { max: formatTokenCount(CHATBOT_LIMIT_MAX, locale) })}
          validateStatus={value !== null && invalid ? 'error' : undefined}
        >
          <InputNumber
            id="chatbot-member-grant"
            min={-CHATBOT_LIMIT_MAX}
            max={CHATBOT_LIMIT_MAX}
            step={STEP}
            precision={0}
            value={value}
            onChange={setValue}
            style={{ width: '100%' }}
          />
        </Form.Item>
        {grant.error === undefined ? null : <ErrorAlert error={grant.error} />}
      </Form>
    </Modal>
  );
}
