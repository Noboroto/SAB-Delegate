'use client';

import { Alert, List } from 'antd';
import { useTranslations } from 'next-intl';
import type { PrivateThreadResult, PrivateThreadStatus } from '@sab/shared';
import { ResultBlock } from '@/components/ui/result-block';
import { useFailureReason } from './thread-batch-views';

/** How many private threads were opened, which members were left out and why. */
export function PrivateThreadResultView({ result }: { result: PrivateThreadResult }) {
  const t = useTranslations('web-tools');
  const reasonOf = useFailureReason();
  const statusText: Record<PrivateThreadStatus, string> = {
    OK: t('threads.private.status.OK', { created: result.created, total: result.total }),
    CHANNEL_NOT_TEXT: t('threads.private.status.CHANNEL_NOT_TEXT'),
    NO_MEMBERS: t('threads.private.status.NO_MEMBERS'),
    INVALID_LINK: t('threads.private.status.INVALID_LINK'),
    MESSAGE_NOT_FOUND: t('threads.private.status.MESSAGE_NOT_FOUND'),
    NO_ACCESS: t('threads.private.status.NO_ACCESS'),
  };
  const type =
    result.status !== 'OK' ? 'info' : result.failures.length === 0 ? 'success' : 'warning';

  return (
    <ResultBlock>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Alert type={type} showIcon title={statusText[result.status]} />
        {result.failures.length === 0 ? null : (
          <List
            size="small"
            bordered
            header={t('threads.private.failuresTitle', { count: result.failures.length })}
            dataSource={result.failures}
            renderItem={(failure) => (
              <List.Item style={{ overflowWrap: 'anywhere' }}>
                {t('threads.private.failure', {
                  id: failure.userId,
                  reason: reasonOf(failure.reason),
                })}
              </List.Item>
            )}
          />
        )}
      </div>
    </ResultBlock>
  );
}
