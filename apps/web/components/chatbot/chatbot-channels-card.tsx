'use client';

import { useState } from 'react';
import { App, Button, Card, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CHATBOT_MAX_CHANNELS, type ChatbotConfig } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { addChatbotChannel, removeChatbotChannel } from '@/lib/chatbot/chatbot-api';
import { TEXT_CHANNEL_TYPES, useChannels } from '@/lib/discord/use-channels';

/** Where the bot answers when it is mentioned; the server refuses a channel a game already uses. */
export function ChatbotChannelsCard({
  guildId,
  channels,
}: {
  guildId: string;
  channels: ChatbotConfig['channels'];
}) {
  const t = useTranslations('web-chatbot');
  const { message } = App.useApp();
  const router = useRouter();
  const known = useChannels(guildId);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [removing, setRemoving] = useState<string | undefined>(undefined);

  const add = useApiMutation((channelId: string) => addChatbotChannel(guildId, channelId));
  const remove = useApiMutation((channelId: string) => removeChatbotChannel(guildId, channelId));
  const busy = add.pending || remove.pending;
  const full = channels.length >= CHATBOT_MAX_CHANNELS;

  const nameOf = (channelId: string): string | undefined =>
    known.data?.find((channel) => channel.id === channelId)?.name;

  const onAdd = async () => {
    if (picked === undefined) return;
    remove.reset();
    const outcome = await add.run(picked);
    if (outcome?.ok !== true) return;
    setPicked(undefined);
    void message.success(t('channels.added'));
    router.refresh();
  };

  const onRemove = async (channelId: string) => {
    add.reset();
    setRemoving(channelId);
    const outcome = await remove.run(channelId);
    setRemoving(undefined);
    if (outcome?.ok !== true) return;
    void message.success(t('channels.removed'));
    router.refresh();
  };

  const failure = add.error ?? remove.error;

  return (
    <Card title={t('channels.title')}>
      <Typography.Paragraph type="secondary">
        {t('channels.description', { max: CHATBOT_MAX_CHANNELS })}
      </Typography.Paragraph>
      {channels.length === 0 ? (
        <Typography.Paragraph>{t('channels.empty')}</Typography.Paragraph>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--space-2)',
          }}
        >
          {channels.map((channelId) => {
            const name = nameOf(channelId);
            return (
              <li key={channelId}>
                <ActionRow>
                  <span style={{ overflowWrap: 'anywhere' }}>
                    {name === undefined ? t('channels.unknown', { id: channelId }) : `# ${name}`}
                  </span>
                  {name === undefined && known.data !== undefined ? (
                    <Tag>{t('channels.missing')}</Tag>
                  ) : null}
                  <Button
                    aria-label={t('channels.removeLabel', { name: name ?? channelId })}
                    loading={removing === channelId}
                    disabled={busy}
                    onClick={() => void onRemove(channelId)}
                  >
                    {t('channels.remove')}
                  </Button>
                </ActionRow>
              </li>
            );
          })}
        </ul>
      )}
      <div style={{ marginTop: 'var(--space-4)' }}>
        {full ? (
          <Typography.Paragraph type="secondary">{t('channels.full')}</Typography.Paragraph>
        ) : (
          <ActionRow>
            <div style={{ flex: '1 1 var(--w-sm)', minWidth: 0 }}>
              <ChannelSelect
                guildId={guildId}
                types={TEXT_CHANNEL_TYPES}
                aria-label={t('channels.pick')}
                placeholder={t('channels.pick')}
                value={picked}
                disabled={busy}
                onChange={setPicked}
              />
            </div>
            <Button
              type="primary"
              loading={add.pending}
              disabled={picked === undefined || busy}
              onClick={() => void onAdd()}
            >
              {t('channels.add')}
            </Button>
          </ActionRow>
        )}
      </div>
      {failure === undefined ? null : (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <ErrorAlert error={failure} />
        </div>
      )}
    </Card>
  );
}
