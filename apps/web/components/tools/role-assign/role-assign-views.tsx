'use client';

import { Alert, List, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import type { RoleAssignResult } from '@sab/shared';
import { IdList } from '../shared/id-list';

/** What the service says a run would change, before anything is touched. */
export function RoleAssignPlanView({ plan, remove }: { plan: RoleAssignResult; remove: boolean }) {
  const t = useTranslations('web-tools');

  if (plan.status === 'NO_REACTORS') {
    return <Alert type="info" showIcon title={t('roleAssign.noReactors')} />;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Typography.Text>
        {t(remove ? 'roleAssign.planTake' : 'roleAssign.planGive', { count: plan.planned })}
      </Typography.Text>
      {plan.skipped === 0 ? null : (
        <Typography.Text type="secondary">
          {t('roleAssign.planSkipped', { count: plan.skipped })}
        </Typography.Text>
      )}
      {plan.sample.length === 0 ? null : (
        <IdList title={t('roleAssign.sampleTitle')} ids={plan.sample} />
      )}
    </div>
  );
}

/** What a confirmed run did, with the members it could not change and why. */
export function RoleAssignOutcome({ result }: { result: RoleAssignResult }) {
  const t = useTranslations('web-tools');
  const allDone = result.failures.length === 0;

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 16, width: '100%' }}>
      <Alert
        type={allDone ? 'success' : 'warning'}
        showIcon
        title={t('roleAssign.outcome', { done: result.done, planned: result.planned })}
      />
      {allDone ? null : (
        <List
          size="small"
          bordered
          header={t('roleAssign.failuresTitle', { count: result.failures.length })}
          dataSource={result.failures}
          renderItem={(failure) => (
            <List.Item style={{ overflowWrap: 'anywhere' }}>
              {t('roleAssign.failure', {
                name: failure.name,
                id: failure.userId,
                reason: failure.reason,
              })}
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
