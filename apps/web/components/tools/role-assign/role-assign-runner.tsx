'use client';

import type { FormInstance } from 'antd';
import { useTranslations } from 'next-intl';
import { RoleAssignResultSchema, type RoleAssignResult } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { postTool } from '@/lib/tools/tool-api';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { ValidatedAction } from '../shared/validated-action';
import { RoleAssignOutcome, RoleAssignPlanView } from './role-assign-views';

interface RoleAssignRunnerProps {
  guildId: string;
  /** The form the request is built from; a click while it is incomplete marks its missing fields. */
  form: FormInstance;
  path: 'role-assign/members' | 'role-assign/reactors';
  /** The request for the form as it stands, or `undefined` while the form is not valid. */
  build: (flags: { dryRun: boolean; confirm: boolean }) => unknown;
  remove: boolean;
  /** Called once a confirmed run has finished. */
  onDone?: () => void;
}

/**
 * Preview, then confirm: the plan shown is the service's own answer to a
 * `dryRun` request, and the real call is only made from the confirm button.
 * Giving a role is a change that is easily undone, so only taking one away is
 * drawn as destructive.
 */
export function RoleAssignRunner({
  guildId,
  form,
  path,
  build,
  remove,
  onDone,
}: RoleAssignRunnerProps) {
  const t = useTranslations('web-tools');
  const done = useWriteDone();
  const current = build({ dryRun: true, confirm: false });
  const [outcome, record] = useRunOutcome<RoleAssignResult>(
    current === undefined ? undefined : JSON.stringify(current),
  );

  const call = (flags: { dryRun: boolean; confirm: boolean }) => {
    const body = build(flags);
    if (body === undefined) return Promise.reject(new Error('The form is not valid.'));
    return postTool(guildId, path, body, RoleAssignResultSchema);
  };

  return (
    <>
      <ValidatedAction form={form} valid={current !== undefined}>
        <ConfirmAction
          danger={remove}
          label={t(remove ? 'roleAssign.takeLabel' : 'roleAssign.giveLabel')}
          modalTitle={t(remove ? 'roleAssign.takeTitle' : 'roleAssign.giveTitle')}
          confirmLabel={t(remove ? 'roleAssign.takeConfirm' : 'roleAssign.giveConfirm')}
          preview={() => call({ dryRun: true, confirm: false })}
          execute={() => call({ dryRun: false, confirm: true })}
          renderPlan={(plan) => <RoleAssignPlanView plan={plan} remove={remove} />}
          canConfirm={(plan) => plan.status === 'OK' && plan.planned > 0}
          onDone={(result) => {
            record(result);
            onDone?.();
            done(t('roleAssign.done'));
          }}
        />
      </ValidatedAction>
      {outcome === undefined ? null : <RoleAssignOutcome result={outcome} />}
    </>
  );
}
