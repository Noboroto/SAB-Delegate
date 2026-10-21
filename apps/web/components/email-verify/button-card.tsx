'use client';

import { useState } from 'react';
import { App, Button, Card, Input, Typography, theme } from 'antd';
import { useTranslations } from 'next-intl';
import type { EmailVerifyButtonInput } from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { ActionRow } from '@/components/ui/action-row';
import { TEXT_CHANNEL_TYPES, useChannels } from '@/lib/discord/use-channels';
import { postEmailVerifyButton } from '@/lib/email-verify/email-verify-api';

/** Posts the message with the verify button in a channel; a field left empty keeps the built-in text. */
export function ButtonCard({
  guildId,
  verifyMessage,
}: {
  guildId: string;
  /** The server's own text for the message; the preview shows it while the field is empty. */
  verifyMessage: string | null;
}) {
  const t = useTranslations('web-email-verify.button');
  const { message } = App.useApp();
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [buttonText, setButtonText] = useState('');
  const { token } = theme.useToken();
  const channels = useChannels(guildId);
  const channelName =
    channels.data?.find((channel) => channel.id === channelId)?.name ?? channelId ?? '';

  const input = (): EmailVerifyButtonInput | undefined =>
    channelId === undefined
      ? undefined
      : {
          channelId,
          ...(title.trim() === '' ? {} : { title: title.trim() }),
          ...(text.trim() === '' ? {} : { message: text.trim() }),
          ...(buttonText.trim() === '' ? {} : { buttonText: buttonText.trim() }),
        };

  return (
    <Card title={t('title')}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Typography.Text type="secondary">{t('intro')}</Typography.Text>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-button-channel">{t('channel')}</label>
          <ChannelSelect
            id="ev-button-channel"
            guildId={guildId}
            types={TEXT_CHANNEL_TYPES}
            value={channelId}
            onChange={setChannelId}
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-button-title">{t('messageTitle')}</label>
          <Input
            id="ev-button-title"
            maxLength={256}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-button-message">{t('message')}</label>
          <Input.TextArea
            id="ev-button-message"
            maxLength={2000}
            autoSize={{ minRows: 3, maxRows: 8 }}
            showCount
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-button-text">{t('buttonText')}</label>
          <Input
            id="ev-button-text"
            maxLength={80}
            value={buttonText}
            onChange={(event) => setButtonText(event.target.value)}
          />
          <Typography.Text type="secondary">{t('defaultHelp')}</Typography.Text>
        </div>
        <section aria-label={t('preview')} style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <Typography.Text strong>{t('preview')}</Typography.Text>
          <div
            style={{
              display: 'grid',
              gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              background: 'var(--surface-secondary)',
              border: '1px solid var(--border)',
              borderLeft: 'var(--space-1) solid var(--primary)',
              borderRadius: token.borderRadiusSM,
              overflowWrap: 'anywhere',
            }}
          >
            <Typography.Text strong>
              {title.trim() === '' ? t('defaultText') : title}
            </Typography.Text>
            <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>
              {text.trim() === '' ? (verifyMessage ?? t('defaultText')) : text}
            </Typography.Text>
            <div>
              <Button tabIndex={-1} aria-hidden>
                {buttonText.trim() === '' ? t('defaultText') : buttonText}
              </Button>
            </div>
          </div>
        </section>
        <ActionRow>
          {channelId === undefined ? (
            <Button type="primary" disabled>
              {t('post')}
            </Button>
          ) : (
            <ConfirmAction
              danger={false}
              label={t('postTo', { channel: channelName })}
              modalTitle={t('confirmTitle')}
              confirmLabel={t('post')}
              // The post is not previewed by the service: the plan is what the form already holds.
              preview={() => Promise.resolve({ channel: channelName })}
              execute={() => {
                const body = input();
                if (body === undefined) return Promise.reject(new Error('no channel'));
                return postEmailVerifyButton(guildId, body);
              }}
              renderPlan={(plan) => (
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {t('confirmPlan', { channel: plan.channel })}
                </Typography.Paragraph>
              )}
              onDone={() => void message.success(t('posted'))}
            />
          )}
          {channelId === undefined ? (
            <Typography.Text type="secondary">{t('channelRequired')}</Typography.Text>
          ) : null}
        </ActionRow>
      </div>
    </Card>
  );
}
