'use client';

import { Button, Descriptions, Form, Input, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  ACTIVITY_EMOJI_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
  ACTIVITY_SHORT_NAME_LENGTH,
  ActivityCreateResultSchema,
  ActivityCreateSchema,
  type ActivityCreateResult,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { CHANNEL_TYPE } from '@/lib/discord/use-channels';
import { buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { ToolCard } from '../shared/tool-card';

interface Values {
  emoji: string;
  name: string;
  shortName: string;
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
    <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
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
  );
}

/** Sets up an activity: its three roles and its channels in the activity category. */
export function ActivityForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const [form] = Form.useForm<Values>();
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'activity', body, ActivityCreateResultSchema),
  );
  const requiredText = { required: true, whitespace: true, message: t('common.required') };

  const onFinish = (values: Values) =>
    action.submit(buildRequest(ActivityCreateSchema, values), {
      refresh: true,
      success: t('activity.done'),
    });

  return (
    <ToolCard title={t('activity.title')} description={t('activity.description')}>
      <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)}>
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
        <Button type="primary" htmlType="submit" loading={action.pending}>
          {t('activity.submit')}
        </Button>
      </Form>
      {action.error === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={action.error} />
        </div>
      )}
      {action.result === undefined ? null : <CreatedIds result={action.result} />}
    </ToolCard>
  );
}
