'use client';

import { Button, Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import {
  parseSnowflakes,
  PRIVATE_THREAD_MAX_MEMBERS,
  PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  PrivateThreadCreateSchema,
  PrivateThreadResultSchema,
  MESSAGE_MAX_LENGTH,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { RoleSelect } from '@/components/forms/role-select';
import { buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { PRIVATE_THREAD_PARENT_TYPES } from './thread-channel-types';
import { PrivateThreadResultView } from './private-thread-result';

interface Values {
  channelId: string;
  prefix: string;
  message: string;
  userIds?: string;
  roleId?: string;
}

/** Opens one private thread per member, named after the member, and posts the same first message in each. */
export function PrivateThreadsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const userIdsText: string | undefined = Form.useWatch('userIds', form);
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'threads/private', body, PrivateThreadResultSchema),
  );

  const onFinish = (values: Values) =>
    action.submit(
      buildRequest(PrivateThreadCreateSchema, {
        channelId: values.channelId,
        prefix: values.prefix,
        message: values.message,
        userIds: parseSnowflakes(values.userIds ?? ''),
        roleId: values.roleId,
      }),
      { refresh: true, success: t('threads.private.done') },
    );

  return (
    <ToolCard title={t('threads.private.title')} description={t('threads.private.description')}>
      <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)}>
        <Form.Item name="channelId" label={t('threads.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={PRIVATE_THREAD_PARENT_TYPES} />
        </Form.Item>
        <Form.Item
          name="prefix"
          label={t('threads.private.prefixLabel')}
          extra={t('threads.private.prefixHelp')}
          rules={[{ required: true, whitespace: true, message: t('common.required') }]}
        >
          <Input maxLength={PRIVATE_THREAD_PREFIX_MAX_LENGTH} />
        </Form.Item>
        <Form.Item
          name="message"
          label={t('threads.private.messageLabel')}
          rules={[{ required: true, whitespace: true, message: t('common.required') }]}
        >
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} maxLength={MESSAGE_MAX_LENGTH} />
        </Form.Item>
        <Form.Item
          name="userIds"
          label={t('threads.private.userIdsLabel')}
          extra={t('threads.private.userIdsHelp', {
            count: parseSnowflakes(userIdsText ?? '').length,
            max: PRIVATE_THREAD_MAX_MEMBERS,
          })}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
        </Form.Item>
        <Form.Item name="roleId" label={t('threads.private.roleLabel')}>
          <RoleSelect guildId={guildId} allowClear />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={action.pending}>
          {t('threads.private.submit')}
        </Button>
      </Form>
      {action.error === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={action.error} />
        </div>
      )}
      {action.result === undefined ? null : <PrivateThreadResultView result={action.result} />}
    </ToolCard>
  );
}
