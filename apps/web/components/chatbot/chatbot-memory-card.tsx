'use client';

import { useState } from 'react';
import { App, Button, Card, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ChatbotMemoryClearResult, ChatbotMemoryClearTargetSchema, z } from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { MemberSelect } from '@/components/forms/member-select';
import { ActionRow } from '@/components/ui/action-row';
import { clearChatbotMemory } from '@/lib/chatbot/chatbot-api';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';

type Target = z.infer<typeof ChatbotMemoryClearTargetSchema>;

/** What the bot remembers is never shown here (it is members' words); it can only be counted and cleared. */
export function ChatbotMemoryCard({ guildId }: { guildId: string }) {
  const t = useTranslations('web-chatbot');
  const { message } = App.useApp();
  const router = useRouter();
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [userId, setUserId] = useState<string | undefined>(undefined);

  // Nothing to clear until the picker has a value: a disabled button, not a flow that cannot run.
  const clearer = (target: Target | undefined, label: string) =>
    target === undefined ? (
      <Button disabled>{label}</Button>
    ) : (
      <ConfirmAction
        label={label}
        modalTitle={t('memory.modalTitle')}
        confirmLabel={t('memory.confirm')}
        preview={() => clearChatbotMemory(guildId, target, true)}
        execute={() => clearChatbotMemory(guildId, target, false)}
        canConfirm={(plan) => plan.userMemories + plan.channelMemories > 0}
        renderPlan={(plan: ChatbotMemoryClearResult) => (
          <Typography.Paragraph>
            {plan.userMemories + plan.channelMemories === 0
              ? t('memory.nothing')
              : t('memory.plan', {
                  members: plan.userMemories,
                  channels: plan.channelMemories,
                })}
          </Typography.Paragraph>
        )}
        onDone={(result) => {
          void message.success(
            t('memory.done', { count: result.userMemories + result.channelMemories }),
          );
          router.refresh();
        }}
      />
    );

  return (
    <Card title={t('memory.title')}>
      <Typography.Paragraph type="secondary">{t('memory.description')}</Typography.Paragraph>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <ActionRow>{clearer({ scope: 'all' }, t('memory.clearAll'))}</ActionRow>
        <ActionRow>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <ChannelSelect
              guildId={guildId}
              types={TEXT_CHANNEL_TYPES}
              aria-label={t('memory.pickChannel')}
              placeholder={t('memory.pickChannel')}
              allowClear
              value={channelId}
              onChange={setChannelId}
            />
          </div>
          {clearer(
            channelId === undefined ? undefined : { scope: 'channel', channelId },
            t('memory.clearChannel'),
          )}
        </ActionRow>
        <ActionRow>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <MemberSelect
              guildId={guildId}
              aria-label={t('memory.pickMember')}
              placeholder={t('memory.pickMember')}
              allowClear
              value={userId}
              onChange={setUserId}
            />
          </div>
          {clearer(
            userId === undefined ? undefined : { scope: 'user', userId },
            t('memory.clearMember'),
          )}
        </ActionRow>
      </div>
    </Card>
  );
}
