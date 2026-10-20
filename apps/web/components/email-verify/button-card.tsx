'use client';

import { useState } from 'react';
import { App, Button, Card, Input, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { EmailVerifyButtonInput } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
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
  const post = useApiMutation((input: EmailVerifyButtonInput) =>
    postEmailVerifyButton(guildId, input),
  );

  const onPost = async () => {
    if (channelId === undefined) return;
    const input: EmailVerifyButtonInput = {
      channelId,
      ...(title.trim() === '' ? {} : { title: title.trim() }),
      ...(text.trim() === '' ? {} : { message: text.trim() }),
      ...(buttonText.trim() === '' ? {} : { buttonText: buttonText.trim() }),
    };
    const outcome = await post.run(input);
    if (outcome?.ok !== true) return;
    void message.success(t('posted'));
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
            onChange={(next) => {
              post.reset();
              setChannelId(next);
            }}
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
              borderLeft: '4px solid var(--primary)',
              borderRadius: 4,
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
        {post.error === undefined ? null : <ErrorAlert error={post.error} />}
        <ActionRow>
          <Button
            type="primary"
            loading={post.pending}
            disabled={channelId === undefined}
            onClick={() => void onPost()}
          >
            {t('post')}
          </Button>
          {channelId === undefined ? (
            <Typography.Text type="secondary">{t('channelRequired')}</Typography.Text>
          ) : null}
        </ActionRow>
      </div>
    </Card>
  );
}
