'use client';

import { Alert, List, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { ResultBlock } from '@/components/ui/result-block';
import { THREAD_FAILURE_REASON, type ThreadBatchPlan, type ThreadBatchResult } from '@sab/shared';

/** Discord's own explanation stays as it came; a code the service uses for its own reasons is worded here. */
export function useFailureReason() {
  const t = useTranslations('web-tools');
  return (reason: string) => {
    if (reason === THREAD_FAILURE_REASON.nameInvalid) return t('threads.reason.nameInvalid');
    if (reason === THREAD_FAILURE_REASON.memberNotFound) return t('threads.reason.memberNotFound');
    return reason;
  };
}

/** The threads a rename or deletion would touch, as the service counted them. */
export function ThreadBatchPlanView({ plan }: { plan: ThreadBatchPlan }) {
  const t = useTranslations('web-tools');

  if (plan.status === 'CHANNEL_CANNOT_HOLD_THREADS') {
    return <Alert type="info" showIcon title={t('threads.batch.cannotHoldThreads')} />;
  }
  if (plan.count === 0) return <Alert type="info" showIcon title={t('threads.batch.noMatch')} />;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Typography.Text>{t('threads.batch.planCount', { count: plan.count })}</Typography.Text>
      {plan.invalid === 0 ? null : (
        <Alert
          type="warning"
          showIcon
          title={t('threads.batch.planInvalid', { count: plan.invalid })}
        />
      )}
      <List
        size="small"
        bordered
        header={t('threads.batch.sampleTitle')}
        dataSource={plan.sample}
        renderItem={(match) => (
          <List.Item style={{ overflowWrap: 'anywhere' }}>
            {match.newName === undefined
              ? match.name
              : t('threads.batch.renameLine', { from: match.name, to: match.newName })}
          </List.Item>
        )}
      />
    </div>
  );
}

/** What a confirmed rename or deletion did, with the threads that could not be changed. */
export function ThreadBatchOutcome({ result }: { result: ThreadBatchResult }) {
  const t = useTranslations('web-tools');
  const reasonOf = useFailureReason();
  const allDone = result.failures.length === 0;

  return (
    <ResultBlock>
      <div style={{ display: 'grid', gap: 'var(--space-3)', width: '100%' }}>
        <Alert
          type={allDone ? 'success' : 'warning'}
          showIcon
          title={t('threads.batch.outcome', { done: result.done, count: result.count })}
        />
        {allDone ? null : (
          <List
            size="small"
            bordered
            header={t('threads.batch.failuresTitle', { count: result.failures.length })}
            dataSource={result.failures}
            renderItem={(failure) => (
              <List.Item style={{ overflowWrap: 'anywhere' }}>
                {t('threads.batch.failure', {
                  name: failure.name,
                  id: failure.threadId,
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
