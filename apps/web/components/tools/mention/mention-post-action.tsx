'use client';

import type { FormInstance } from 'antd';
import { Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { MentionResultSchema, type MentionResult } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { postTool } from '@/lib/tools/tool-api';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { ValidatedAction } from '../shared/validated-action';
import { MentionResultBody } from './mention-result-view';

interface MentionPostActionProps {
  guildId: string;
  form: FormInstance;
  path: 'mention/reactors' | 'mention/non-reactors';
  /** The request for the form as it stands, or `undefined` while it is not valid. */
  build: (dryRun: boolean) => unknown;
  onPosted: (result: MentionResult) => void;
}

/**
 * Posting a mention list as a reply is public: the service's `dryRun` answer
 * (who would be named, and the exact messages) is shown first and the real
 * call is made only from the confirm button. It destroys nothing, so the
 * confirm button is not the red one.
 */
export function MentionPostAction({
  guildId,
  form,
  path,
  build,
  onPosted,
}: MentionPostActionProps) {
  const t = useTranslations('web-tools');
  const done = useWriteDone();

  const body = (dryRun: boolean) => {
    const request = build(dryRun);
    if (request === undefined) throw new Error('The form is not valid.');
    return request;
  };

  return (
    <ValidatedAction form={form} valid={build(true) !== undefined}>
      <ConfirmAction
        danger={false}
        label={t('mention.previewLabel')}
        modalTitle={t('mention.postModalTitle')}
        confirmLabel={t('mention.postConfirm')}
        preview={() => postTool(guildId, path, body(true), MentionResultSchema)}
        execute={() => postTool(guildId, path, body(false), MentionResultSchema)}
        renderPlan={(plan) => (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {plan.status === 'OK' ? (
              <Typography.Text>{t('mention.planIntro')}</Typography.Text>
            ) : null}
            <MentionResultBody result={plan} />
          </div>
        )}
        canConfirm={(plan) => plan.status === 'OK' && plan.count > 0}
        onDone={(result) => {
          onPosted(result);
          // A refused reply still comes back as an answer (SEND_FAILED), shown under the form; only a real post is cheered.
          if (result.status === 'OK') done(t('mention.posted'));
        }}
      />
    </ValidatedAction>
  );
}
