'use client';

import { Card, Statistic, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import type { SystemOverview } from '@sab/shared';
import { uptimeParts } from '@/lib/overview/uptime';

/** Whether the bot is up, for how long, and how fast it talks to Discord. */
export function BotStatusCard({ uptimeMs, wsPing }: SystemOverview) {
  const t = useTranslations('web-overview');
  const parts = uptimeParts(uptimeMs);

  const uptime = (() => {
    switch (parts.unit) {
      case 'days':
        return t('uptime.days', parts);
      case 'hours':
        return t('uptime.hours', parts);
      case 'minutes':
        return t('uptime.minutes', parts);
      case 'lessThanMinute':
        return t('uptime.lessThanMinute');
    }
  })();

  return (
    <Card
      title={t('status.title')}
      extra={<Tag color="success">{t('status.online')}</Tag>}
      style={{ height: '100%' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 48px' }}>
        <Statistic title={t('status.uptime')} value={uptime} />
        {/* -1 is discord.js saying no heartbeat has been measured yet. */}
        <Statistic
          title={t('status.latency')}
          value={
            wsPing < 0 ? t('status.latencyUnknown') : t('status.latencyValue', { ping: wsPing })
          }
        />
      </div>
    </Card>
  );
}
