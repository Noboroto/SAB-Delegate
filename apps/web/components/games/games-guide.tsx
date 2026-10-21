'use client';

import { MiniGameSchema, type MiniGame } from '@sab/shared';
import { Card, Col, Row, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { Heading } from '@/components/ui/heading';
import { SectionTitle } from '@/components/ui/section-title';

/**
 * The help texts mark commands with backticks, as Discord renders them; here
 * they become inline code so a command reads the same in both places.
 */
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (
        // Odd parts sit between two backticks. The split is fixed per text, so
        // the index is a stable key.
        <Fragment key={index}>
          {index % 2 === 1 ? <Typography.Text code>{part}</Typography.Text> : part}
        </Fragment>
      ))}
    </>
  );
}

/** One card per game: its rules, then the commands that set it up. */
export function GamesGuide() {
  const nav = useTranslations('servers.nav');
  const t = useTranslations('mini-game');
  const games: readonly MiniGame[] = MiniGameSchema.options;

  return (
    <>
      <Heading title={nav('games')} subtitle={nav('gamesSubtitle')} />
      <Row gutter={[16, 16]}>
        {games.map((game) => (
          <Col key={game} xs={24} lg={12}>
            <Card
              title={<SectionTitle flush>{t(`names.${game}`)}</SectionTitle>}
              style={{ height: '100%' }}
            >
              <SectionTitle level={3}>{t('rulesTitle')}</SectionTitle>
              <Typography.Paragraph>
                <WithCode text={t(`help.${game}.rules`)} />
              </Typography.Paragraph>
              <SectionTitle level={3}>{t('setupTitle')}</SectionTitle>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                <WithCode text={t(`help.${game}.setup`)} />
              </Typography.Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 'var(--space-4)' }}>
        <WithCode text={t('leaderboardHint')} />
      </Typography.Paragraph>
    </>
  );
}
