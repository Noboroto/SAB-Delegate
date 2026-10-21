'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Alert, Collapse, Descriptions, Drawer, Spin, Typography, theme } from 'antd';
import { useTranslations } from 'next-intl';
import {
  ChatbotTurnDetailSchema,
  formatTokenCount,
  type ChatbotTurnContext,
  type ChatbotTurnDetail,
} from '@sab/shared';
import { DiscordTimestamp } from '@/components/data/discord-timestamp';
import { ErrorAlert } from '@/components/data/error-alert';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';
import { useLookup } from '@/lib/discord/use-lookup';
import { guildApiPath } from '@/lib/guild-path';
import { ChatbotTurnDelete } from './chatbot-turn-delete';

const PLAIN: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: 0,
};

const SCROLL: CSSProperties = { ...PLAIN, maxHeight: '30vh', overflow: 'auto' };

/**
 * Members' words and the model's, as text nodes: React escapes them, and they
 * are never handed to a markdown or HTML renderer, so nothing a member typed
 * can become markup on an admin's screen.
 */
function PlainText({ text, scroll = false }: { text: string; scroll?: boolean }) {
  return <p style={scroll ? SCROLL : PLAIN}>{text}</p>;
}

function ContextSections({ context }: { context: ChatbotTurnContext }) {
  const t = useTranslations('web-chatbot');
  const memory = [
    { key: 'channel', label: t('history.detail.memoryChannel'), text: context.memory.channel },
    { key: 'user', label: t('history.detail.memoryUser'), text: context.memory.user },
  ].filter((entry) => entry.text !== undefined);
  const items = [
    {
      key: 'system',
      label: t('history.detail.system'),
      children: <PlainText text={context.system} scroll />,
    },
    {
      key: 'messages',
      label: t('history.detail.messages', { count: context.channelMessages.length }),
      children:
        context.channelMessages.length === 0 ? (
          <Typography.Text type="secondary">{t('history.detail.none')}</Typography.Text>
        ) : (
          <div
            style={{ display: 'grid', gap: 'var(--space-3)', maxHeight: '40vh', overflow: 'auto' }}
          >
            {context.channelMessages.map((line, index) => (
              <div key={`${line.at}:${index}`}>
                <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
                  {line.authorName}
                </Typography.Text>{' '}
                <Typography.Text type="secondary">
                  <DiscordTimestamp value={line.at} />
                </Typography.Text>
                <PlainText text={line.content} />
              </div>
            ))}
          </div>
        ),
    },
    {
      key: 'memory',
      label: t('history.detail.memory'),
      children:
        memory.length === 0 ? (
          <Typography.Text type="secondary">{t('history.detail.none')}</Typography.Text>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {memory.map((entry) => (
              <div key={entry.key}>
                <Typography.Text strong>{entry.label}</Typography.Text>
                <PlainText text={entry.text ?? ''} />
              </div>
            ))}
          </div>
        ),
    },
    {
      key: 'attachments',
      label: t('history.detail.attachments', { count: context.attachments.length }),
      children:
        context.attachments.length === 0 ? (
          <Typography.Text type="secondary">{t('history.detail.none')}</Typography.Text>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {context.attachments.map((file, index) => (
              <PlainText
                key={`${file.name}:${index}`}
                text={`${file.name} (${file.kind}, ${file.bytes} B) - ${
                  file.included ? t('history.detail.included') : t('history.detail.skipped')
                }${file.note === undefined ? '' : `: ${file.note}`}`}
              />
            ))}
          </div>
        ),
    },
  ];

  return <Collapse items={items} />;
}

function Detail({
  guildId,
  turn,
  channelName,
  onDeleted,
}: {
  guildId: string;
  turn: ChatbotTurnDetail;
  channelName: string;
  onDeleted: () => void;
}) {
  const t = useTranslations('web-chatbot');
  const tLlm = useTranslations('web-settings');
  const { token } = theme.useToken();
  const locale = useUiLocale();
  const count = (value: number) => formatTokenCount(value, locale);

  const statusLabels: Record<ChatbotTurnDetail['status'], string> = {
    OK: t('history.status.OK'),
    QUOTA_EXHAUSTED: t('history.status.QUOTA_EXHAUSTED'),
    NOT_CONFIGURED: t('history.status.NOT_CONFIGURED'),
    FAILED: t('history.status.FAILED'),
    PENDING: t('history.status.PENDING'),
    EXPIRED: t('history.status.EXPIRED'),
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Alert type="info" showIcon title={t('history.detail.plainNotice')} />
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: 'time',
            label: t('history.columns.time'),
            children: <DiscordTimestamp value={turn.createdAt} />,
          },
          { key: 'member', label: t('history.columns.member'), children: turn.userId },
          { key: 'channel', label: t('history.columns.channel'), children: channelName },
          {
            key: 'status',
            label: t('history.columns.status'),
            children: statusLabels[turn.status],
          },
          ...(turn.failureReason === null
            ? []
            : [
                {
                  key: 'reason',
                  label: t('history.detail.reason'),
                  children: tLlm(`llm.form.testReasons.${turn.failureReason}`),
                },
              ]),
          ...(turn.model === null
            ? []
            : [
                {
                  key: 'model',
                  label: t('history.detail.model'),
                  children:
                    turn.llmSource === null
                      ? turn.model
                      : `${turn.model} (${t(`llm.sources.${turn.llmSource}`)})`,
                },
              ]),
          {
            key: 'tokens',
            label: t('history.columns.tokens'),
            children: `${turn.estimated ? '≈ ' : ''}${count(turn.inputTokens)} / ${count(turn.outputTokens)}`,
          },
        ]}
      />
      <section>
        <Typography.Title level={2} style={{ fontSize: token.fontSizeHeading5 }}>
          {t('history.detail.question')}
        </Typography.Title>
        <PlainText text={turn.question} />
      </section>
      <section>
        <Typography.Title level={2} style={{ fontSize: token.fontSizeHeading5 }}>
          {t('history.detail.answer')}
        </Typography.Title>
        {turn.answer === null ? (
          <Typography.Text type="secondary">{t('history.detail.noAnswer')}</Typography.Text>
        ) : (
          <PlainText text={turn.answer} />
        )}
      </section>
      <section>
        <Typography.Title level={2} style={{ fontSize: token.fontSizeHeading5 }}>
          {t('history.detail.context')}
        </Typography.Title>
        {turn.context === null ? (
          <Alert type="warning" showIcon title={t('history.detail.contextLost')} />
        ) : (
          <ContextSections context={turn.context} />
        )}
      </section>
      <div>
        <ChatbotTurnDelete
          guildId={guildId}
          target={{ scope: 'turn', turnId: turn.id }}
          label={t('history.delete.one')}
          onDone={onDeleted}
        />
      </div>
    </div>
  );
}

/** One exchange with everything the model was given; fetched when opened, so a list never carries the snapshots. */
export function ChatbotTurnDrawer({
  guildId,
  turnId,
  channelName,
  onClose,
}: {
  guildId: string;
  turnId: string | undefined;
  channelName: (channelId: string) => string;
  onClose: () => void;
}): ReactNode {
  const t = useTranslations('web-chatbot');
  const detail = useLookup(
    turnId === undefined ? null : guildApiPath(guildId, 'chatbot', 'turns', turnId),
    ChatbotTurnDetailSchema,
  );

  return (
    <Drawer
      open={turnId !== undefined}
      onClose={onClose}
      title={t('history.detail.title')}
      size="min(var(--form-w), 100vw)"
      destroyOnHidden
    >
      {detail.data !== undefined && detail.data.id === turnId ? (
        <Detail
          guildId={guildId}
          turn={detail.data}
          channelName={channelName(detail.data.channelId)}
          onDeleted={onClose}
        />
      ) : detail.error !== undefined ? (
        <ErrorAlert error={detail.error} onRetry={detail.reload} />
      ) : (
        <div role="status" aria-label={t('history.detail.loading')} style={{ textAlign: 'center' }}>
          <Spin />
        </div>
      )}
    </Drawer>
  );
}
