'use client';

import { Alert, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { MentionResult, MentionStatus } from '@sab/shared';
import { ResultBlock } from '@/components/ui/result-block';
import { IdList } from '../shared/id-list';
import { TextBlock } from '../shared/text-block';

/** What the service made of a request, as it answered; the lists are shown, never re-computed. */
export function MentionResultBody({ result }: { result: MentionResult }) {
  const t = useTranslations('web-tools');
  const statusText: Record<MentionStatus, string> = {
    OK: t('mention.status.OK', { count: result.count }),
    NO_REACTORS: t('mention.status.NO_REACTORS'),
    ALL_REACTED: t('mention.status.ALL_REACTED'),
    UNSUPPORTED_CHANNEL: t('mention.status.UNSUPPORTED_CHANNEL'),
    SEND_FAILED: t('mention.status.SEND_FAILED', {
      posted: result.postedChunks,
      total: result.chunks.length,
    }),
  };
  const alertType =
    result.status === 'OK' ? 'success' : result.status === 'SEND_FAILED' ? 'error' : 'info';

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Alert type={alertType} showIcon title={statusText[result.status]} />
      {result.failure === undefined ? null : (
        <Typography.Text type="secondary">
          {t('mention.failure', { reason: result.failure })}
        </Typography.Text>
      )}
      {result.delivered ? (
        <Alert
          type="success"
          showIcon
          title={t('mention.delivered', { count: result.postedChunks })}
        />
      ) : null}
      {result.sample.length === 0 ? null : (
        <IdList title={t('mention.sampleTitle')} ids={result.sample} />
      )}
      {result.chunks.map((chunk, index) => (
        <div key={index} style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <Typography.Text strong>
            {t('mention.chunkTitle', { index: index + 1, total: result.chunks.length })}
          </Typography.Text>
          <TextBlock text={chunk} copyLabel={t('mention.copyChunk', { index: index + 1 })} />
        </div>
      ))}
    </div>
  );
}

/** The answer under a form, set `--space-4` below its buttons. */
export function MentionResultView({ result }: { result: MentionResult }) {
  return (
    <ResultBlock>
      <MentionResultBody result={result} />
    </ResultBlock>
  );
}
