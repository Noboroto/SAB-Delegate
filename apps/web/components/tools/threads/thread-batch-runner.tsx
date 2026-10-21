'use client';

import type { FormInstance } from 'antd';
import {
  ThreadBatchPlanSchema,
  ThreadBatchResultSchema,
  type ThreadBatchResult,
} from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { postTool } from '@/lib/tools/tool-api';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { ValidatedAction } from '../shared/validated-action';
import { ThreadBatchOutcome, ThreadBatchPlanView } from './thread-batch-views';

interface ThreadBatchRunnerProps {
  guildId: string;
  /** The form the request is built from; a click while it is incomplete marks its missing fields. */
  form: FormInstance;
  path: 'threads/rename' | 'threads/delete';
  /** The request for the form as it stands, or `undefined` while the form is not valid. */
  build: (flags: { dryRun: boolean; confirm: boolean }) => unknown;
  label: string;
  modalTitle: string;
  confirmLabel: string;
  doneText: string;
}

/**
 * Preview, then confirm, for a change that reaches many threads at once: the
 * plan on screen is the service's answer to a `dryRun`, and the real call is
 * only made from the confirm button.
 */
export function ThreadBatchRunner({
  guildId,
  form,
  path,
  build,
  label,
  modalTitle,
  confirmLabel,
  doneText,
}: ThreadBatchRunnerProps) {
  const done = useWriteDone();
  const current = build({ dryRun: true, confirm: false });
  const valid = current !== undefined;
  const [outcome, record] = useRunOutcome<ThreadBatchResult>(
    current === undefined ? undefined : JSON.stringify(current),
  );

  const body = (flags: { dryRun: boolean; confirm: boolean }) => {
    const request = build(flags);
    if (request === undefined) throw new Error('The form is not valid.');
    return request;
  };

  return (
    <>
      <ValidatedAction form={form} valid={valid}>
        <ConfirmAction
          label={label}
          modalTitle={modalTitle}
          confirmLabel={confirmLabel}
          preview={() =>
            postTool(guildId, path, body({ dryRun: true, confirm: false }), ThreadBatchPlanSchema)
          }
          execute={() =>
            postTool(guildId, path, body({ dryRun: false, confirm: true }), ThreadBatchResultSchema)
          }
          renderPlan={(plan) => <ThreadBatchPlanView plan={plan} />}
          canConfirm={(plan) => plan.status === 'OK' && plan.count > 0}
          onDone={(result) => {
            record(result);
            done(doneText);
          }}
        />
      </ValidatedAction>
      {outcome === undefined ? null : <ThreadBatchOutcome result={outcome} />}
    </>
  );
}
