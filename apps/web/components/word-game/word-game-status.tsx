'use client';

import { Card, Descriptions, Progress, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import type { WordGameInfo } from '@sab/shared';
import { ChannelLabel } from '@/components/messaging/channel-label';
import { WordGameReset } from './word-game-reset';

/** Where the game is played and how far the current round has got. */
export function WordGameStatus({ guildId, info }: { guildId: string; info: WordGameInfo }) {
  const t = useTranslations('web-word-game');
  const percent = Math.min(100, Math.round((info.count / info.maxWords) * 100));
  const state = info.finished
    ? t('status.finished')
    : info.started
      ? t('status.playing')
      : t('status.waiting');

  return (
    <Card title={t('status.title')} extra={<WordGameReset guildId={guildId} />}>
      <Descriptions
        column={{ xs: 1, sm: 2 }}
        items={[
          {
            key: 'channel',
            label: t('status.channel'),
            children:
              info.channelId === null ? (
                t('status.notConfigured')
              ) : (
                <ChannelLabel guildId={guildId} channelId={info.channelId} />
              ),
          },
          {
            key: 'state',
            label: t('status.state'),
            // Text carries the state; the colour only repeats it.
            children: <Tag color={info.finished ? 'warning' : 'processing'}>{state}</Tag>,
          },
          {
            key: 'progress',
            label: t('status.progress'),
            children: (
              <div style={{ maxWidth: 'var(--w-md)' }}>
                <Progress
                  percent={percent}
                  size="small"
                  format={() => t('status.count', { count: info.count, max: info.maxWords })}
                  aria-label={t('status.progress')}
                />
              </div>
            ),
          },
          {
            key: 'lastWord',
            label: t('status.lastWord'),
            children: info.lastWord === '' ? t('status.noneYet') : info.lastWord,
          },
        ]}
      />
    </Card>
  );
}
