'use client';

import { Col, Row } from 'antd';
import { useTranslations } from 'next-intl';
import type { SystemOverview } from '@sab/shared';
import { Heading } from '@/components/ui/heading';
import { BotStatusCard } from './bot-status-card';
import { OverviewUnavailable } from './overview-unavailable';
import { SectionShortcuts } from './section-shortcuts';

interface ServerOverviewProps {
  guildId: string;
  guildName: string;
  /** `undefined` when the bot's status could not be read. */
  overview: SystemOverview | undefined;
}

/** The dashboard's first page: the server's name, the bot's health, and the way into every other page. */
export function ServerOverview({ guildId, guildName, overview }: ServerOverviewProps) {
  const t = useTranslations('web-overview');

  return (
    <>
      <Heading title={guildName} subtitle={t('subtitle')} />
      <Row gutter={[16, 16]}>
        <Col span={24}>
          {overview === undefined ? (
            <OverviewUnavailable />
          ) : (
            <BotStatusCard uptimeMs={overview.uptimeMs} wsPing={overview.wsPing} />
          )}
        </Col>
        <Col span={24}>
          <SectionShortcuts guildId={guildId} />
        </Col>
      </Row>
    </>
  );
}
