'use client';

import { useState } from 'react';
import { Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { RoleAssignResultSchema, type RoleAssignResult } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { postTool } from '@/lib/tools/tool-api';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { RoleAssignOutcome, RoleAssignPlanView } from './role-assign-views';

interface RoleAssignRunnerProps {
  guildId: string;
  path: 'role-assign/members' | 'role-assign/reactors';
  /** The request for the form as it stands, or `undefined` while the form is not valid. */
  build: (flags: { dryRun: boolean; confirm: boolean }) => unknown;
  remove: boolean;
}

/**
 * Preview, then confirm: the plan shown is the service's own answer to a
 * `dryRun` request, and the real call is only made from the confirm button.
 */
export function RoleAssignRunner({ guildId, path, build, remove }: RoleAssignRunnerProps) {
  const t = useTranslations('web-tools');
  const done = useWriteDone();
  const [outcome, setOutcome] = useState<RoleAssignResult | undefined>(undefined);
  const valid = build({ dryRun: true, confirm: false }) !== undefined;

  const call = (flags: { dryRun: boolean; confirm: boolean }) => {
    const body = build(flags);
    if (body === undefined) return Promise.reject(new Error('The form is not valid.'));
    return postTool(guildId, path, body, RoleAssignResultSchema);
  };

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <ConfirmAction
        label={t(remove ? 'roleAssign.takeLabel' : 'roleAssign.giveLabel')}
        modalTitle={t(remove ? 'roleAssign.takeTitle' : 'roleAssign.giveTitle')}
        confirmLabel={t(remove ? 'roleAssign.takeConfirm' : 'roleAssign.giveConfirm')}
        disabled={!valid}
        preview={() => {
          setOutcome(undefined);
          return call({ dryRun: true, confirm: false });
        }}
        execute={() => call({ dryRun: false, confirm: true })}
        renderPlan={(plan) => <RoleAssignPlanView plan={plan} remove={remove} />}
        canConfirm={(plan) => plan.status === 'OK' && plan.planned > 0}
        onDone={(result) => {
          setOutcome(result);
          done(t('roleAssign.done'));
        }}
      />
      {valid ? null : (
        <Typography.Text type="secondary">{t('common.fillRequired')}</Typography.Text>
      )}
      {outcome === undefined ? null : <RoleAssignOutcome result={outcome} />}
    </div>
  );
}
