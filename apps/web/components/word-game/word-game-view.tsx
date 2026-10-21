'use client';

import { Col, Row } from 'antd';
import { useTranslations } from 'next-intl';
import type { WordGameInfo, WordGameWordsPage, WordGameWordsQuery } from '@sab/shared';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { WordGameConfigForm } from './word-game-config-form';
import { WordGameStatus } from './word-game-status';
import { WordGameWordsTable } from './word-game-words-table';

interface WordGameViewProps {
  guildId: string;
  info: WordGameInfo;
  words: WordGameWordsPage;
  query: WordGameWordsQuery;
}

/** The word-chain game of one server: where it runs, how the round stands, and the words used so far. */
export function WordGameView({ guildId, info, words, query }: WordGameViewProps) {
  const t = useTranslations('web-word-game');

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <WordGameStatus guildId={guildId} info={info} />
        </Col>
        <Col xs={24} xl={10}>
          {/* Re-seeds the form's fields when a refresh brings other server values. */}
          <FormColumn>
            <WordGameConfigForm
              key={`${info.channelId ?? ''}:${info.maxWords ?? ''}`}
              guildId={guildId}
              info={info}
            />
          </FormColumn>
        </Col>
        <Col xs={24} xl={14}>
          <WordGameWordsTable words={words} query={query} />
        </Col>
      </Row>
    </>
  );
}
