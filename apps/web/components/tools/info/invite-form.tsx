'use client';

import { Button, Form, Input, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { INVITE_REASON_MAX_LENGTH, InviteCreateSchema, InviteResultSchema } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { CHANNEL_TYPE } from '@/lib/discord/use-channels';
import { blankToUndefined, buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { TextBlock } from '../shared/text-block';
import { ToolCard } from '../shared/tool-card';

/** Channels an invite can point at; a category cannot be joined. */
const INVITE_CHANNEL_TYPES: readonly number[] = [
  CHANNEL_TYPE.text,
  CHANNEL_TYPE.announcement,
  CHANNEL_TYPE.voice,
  CHANNEL_TYPE.stage,
  CHANNEL_TYPE.forum,
];

interface Values {
  channelId: string;
  reason?: string;
}

/** Creates an invite link to a channel. */
export function InviteForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'info/invite', body, InviteResultSchema),
  );

  const onFinish = (values: Values) =>
    action.submit(
      buildRequest(InviteCreateSchema, {
        channelId: values.channelId,
        reason: blankToUndefined(values.reason),
      }),
      { refresh: true, success: t('info.invite.done') },
    );

  return (
    <ToolCard title={t('info.invite.title')} description={t('info.invite.description')}>
      <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)}>
        <Form.Item name="channelId" label={t('info.invite.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={INVITE_CHANNEL_TYPES} />
        </Form.Item>
        <Form.Item
          name="reason"
          label={t('info.invite.reasonLabel')}
          extra={t('info.invite.reasonHelp')}
        >
          <Input maxLength={INVITE_REASON_MAX_LENGTH} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={action.pending}>
          {t('info.invite.submit')}
        </Button>
      </Form>
      {action.error === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={action.error} />
        </div>
      )}
      {action.result === undefined ? null : (
        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <Typography.Text>
            {t('info.invite.created', { channel: action.result.channelName })}
          </Typography.Text>
          <TextBlock text={action.result.url} />
        </div>
      )}
    </ToolCard>
  );
}
