'use client';

import { Alert, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { PurgePlan, PurgeResult, PurgeStatus } from '@sab/shared';
import { IdList } from '../shared/id-list';

function useStatusText() {
  const t = useTranslations('web-tools');
  const text: Record<Exclude<PurgeStatus, 'OK'>, string> = {
    UNTIL_NOT_FOUND: t('purge.status.UNTIL_NOT_FOUND'),
    FROM_NOT_FOUND: t('purge.status.FROM_NOT_FOUND'),
    RANGE_REVERSED: t('purge.status.RANGE_REVERSED'),
    RANGE_TOO_LARGE: t('purge.status.RANGE_TOO_LARGE'),
  };
  return text;
}

/** The messages a purge would delete, as the service selected them. */
export function PurgePlanView({ plan }: { plan: PurgePlan }) {
  const t = useTranslations('web-tools');
  const statusText = useStatusText();

  if (plan.status !== 'OK')
    return <Alert type="warning" showIcon title={statusText[plan.status]} />;
  if (plan.count === 0) return <Alert type="info" showIcon title={t('purge.planEmpty')} />;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Typography.Text strong>{t('purge.planCount', { count: plan.count })}</Typography.Text>
      {plan.olderCount === 0 ? null : (
        <Typography.Text type="secondary">
          {t('purge.planOlder', { count: plan.olderCount })}
        </Typography.Text>
      )}
      <IdList title={t('purge.sampleTitle')} ids={plan.sample} />
    </div>
  );
}

/** What a confirmed purge did. */
export function PurgeOutcome({ result }: { result: PurgeResult }) {
  const t = useTranslations('web-tools');
  const statusText = useStatusText();

  if (result.status !== 'OK') {
    return <Alert type="warning" showIcon title={statusText[result.status]} />;
  }
  return (
    <Alert
      type={result.failed === 0 ? 'success' : 'warning'}
      showIcon
      title={t('purge.outcome', { deleted: result.deleted, count: result.count })}
      description={
        result.failed === 0 ? undefined : t('purge.outcomeFailed', { count: result.failed })
      }
    />
  );
}
