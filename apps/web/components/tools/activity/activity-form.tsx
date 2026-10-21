'use client';

import { Descriptions, Form, Input, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  ACTIVITY_EMOJI_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
  ACTIVITY_SHORT_NAME_LENGTH,
  ActivityCreateResultSchema,
  ActivityCreateSchema,
  type ActivityCreateResult,
} from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { ResultBlock } from '@/components/ui/result-block';
import { CHANNEL_TYPE } from '@/lib/discord/use-channels';
import { buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { ToolCard } from '../shared/tool-card';
import { ValidatedAction } from '../shared/validated-action';
import { ActivityPlanView, planActivity } from './activity-plan';

interface Values {
  emoji?: string;
  name?: string;
  shortName?: string;
  categoryId?: string;
}

function CreatedIds({ result }: { result: ActivityCreateResult }) {
  const t = useTranslations('web-tools');
  const rows: [string, string][] = [
    [t('activity.result.category'), result.categoryId],
    [t('activity.result.roleEvent'), result.roles.event],
    [t('activity.result.roleMulti'), result.roles.multi],
    [t('activity.result.roleMc'), result.roles.mc],
    [t('activity.result.channelGeneral'), result.channels.general],
    [t('activity.result.channelThreadOnly'), result.channels.threadOnly],
    [t('activity.result.channelVoice'), result.channels.voice],
  ];

  return (
    <ResultBlock>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <Typography.Text strong>{t('activity.result.title')}</Typography.Text>
        <Descriptions
          bordered
          size="small"
          column={1}
          items={rows.map(([label, id]) => ({
            key: label,
            label,
            children: <Typography.Text copyable>{id}</Typography.Text>,
          }))}
        />
      </div>
    </ResultBlock>
  );
}

/** Sets up an activity: its three roles and its channels in the activity category. */
export function ActivityForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const done = useWriteDone();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const requiredText = { required: true, whitespace: true, message: t('common.required') };

  const request = buildRequest(ActivityCreateSchema, values);
  const [created, record] = useRunOutcome<ActivityCreateResult>(
    request === undefined ? undefined : JSON.stringify(request),
  );

  return (
    <ToolCard>
      <Form form={form} layout="vertical">
        <Form.Item name="emoji" label={t('activity.emojiLabel')} rules={[requiredText]}>
          <Input maxLength={ACTIVITY_EMOJI_MAX_LENGTH} />
        </Form.Item>
        <Form.Item name="name" label={t('activity.nameLabel')} rules={[requiredText]}>
          <Input maxLength={ACTIVITY_NAME_MAX_LENGTH} />
        </Form.Item>
        <Form.Item
          name="shortName"
          label={t('activity.shortNameLabel')}
          extra={t('activity.shortNameHelp', { length: ACTIVITY_SHORT_NAME_LENGTH })}
          rules={[
            requiredText,
            {
              len: ACTIVITY_SHORT_NAME_LENGTH,
              message: t('activity.shortNameHelp', { length: ACTIVITY_SHORT_NAME_LENGTH }),
            },
          ]}
        >
          <Input maxLength={ACTIVITY_SHORT_NAME_LENGTH} />
        </Form.Item>
        <Form.Item
          name="categoryId"
          label={t('activity.categoryLabel')}
          extra={t('activity.categoryHelp')}
        >
          <ChannelSelect guildId={guildId} types={[CHANNEL_TYPE.category]} allowClear />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <ValidatedAction form={form} valid={request !== undefined}>
            <ConfirmAction
              danger={false}
              label={t('activity.previewLabel')}
              modalTitle={t('activity.modalTitle')}
              confirmLabel={t('activity.submit')}
              preview={() =>
                request === undefined
                  ? Promise.reject(new Error('The form is not valid.'))
                  : Promise.resolve(planActivity(request))
              }
              execute={() => {
                if (request === undefined)
                  return Promise.reject(new Error('The form is not valid.'));
                return postTool(guildId, 'activity', request, ActivityCreateResultSchema);
              }}
              renderPlan={(plan) => <ActivityPlanView guildId={guildId} plan={plan} />}
              onDone={(result) => {
                record(result);
                done(t('activity.done'));
              }}
            />
          </ValidatedAction>
        </Form.Item>
      </Form>
      {created === undefined ? null : <CreatedIds result={created} />}
    </ToolCard>
  );
}
