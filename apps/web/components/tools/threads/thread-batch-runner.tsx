'use client';

import { useState } from 'react';
import { Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  ThreadBatchPlanSchema,
  ThreadBatchResultSchema,
  type ThreadBatchResult,
} from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { postTool } from '@/lib/tools/tool-api';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { ThreadBatchOutcome, ThreadBatchPlanView } from './thread-batch-views';

interface ThreadBatchRunnerProps {
  guildId: string;
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
  path,
  build,
  label,
  modalTitle,
  confirmLabel,
  doneText,
}: ThreadBatchRunnerProps) {
  const t = useTranslations('web-tools');
  const done = useWriteDone();
  const [outcome, setOutcome] = useState<ThreadBatchResult | undefined>(undefined);
  const valid = build({ dryRun: true, confirm: false }) !== undefined;

  const body = (flags: { dryRun: boolean; confirm: boolean }) => {
    const request = build(flags);
    if (request === undefined) throw new Error('The form is not valid.');
    return request;
  };

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <ConfirmAction
        label={label}
        modalTitle={modalTitle}
        confirmLabel={confirmLabel}
        disabled={!valid}
        preview={() => {
          setOutcome(undefined);
          return postTool(
            guildId,
            path,
            body({ dryRun: true, confirm: false }),
            ThreadBatchPlanSchema,
          );
        }}
        execute={() =>
          postTool(guildId, path, body({ dryRun: false, confirm: true }), ThreadBatchResultSchema)
        }
        renderPlan={(plan) => <ThreadBatchPlanView plan={plan} />}
        canConfirm={(plan) => plan.status === 'OK' && plan.count > 0}
        onDone={(result) => {
          setOutcome(result);
          done(doneText);
        }}
      />
      {valid ? null : (
        <Typography.Text type="secondary">{t('common.fillRequired')}</Typography.Text>
      )}
      {outcome === undefined ? null : <ThreadBatchOutcome result={outcome} />}
    </div>
  );
}
