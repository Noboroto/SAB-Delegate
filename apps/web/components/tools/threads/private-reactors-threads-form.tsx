'use client';

import { Button, Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import {
  MESSAGE_MAX_LENGTH,
  PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  PrivateThreadFromReactorsSchema,
  PrivateThreadResultSchema,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { EmojiItem, MessageRefItem, useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { PRIVATE_THREAD_PARENT_TYPES } from './thread-channel-types';
import { PrivateThreadResultView } from './private-thread-result';

interface Values {
  channelId: string;
  prefix: string;
  message: string;
  messageLink: string;
  emoji: string;
}

/** Opens a private thread for everyone who reacted to a message with one emoji. */
export function PrivateReactorsThreadsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'threads/private/reactors', body, PrivateThreadResultSchema),
  );

  const onFinish = (values: Values) =>
    action.submit(buildRequest(PrivateThreadFromReactorsSchema, values), {
      refresh: true,
      success: t('threads.private.done'),
    });

  return (
    <ToolCard
      title={t('threads.privateReactors.title')}
      description={t('threads.privateReactors.description')}
    >
      <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)}>
        <MessageRefItem name="messageLink" label={t('threads.privateReactors.messageLabel')} />
        <EmojiItem name="emoji" label={t('threads.privateReactors.emojiLabel')} />
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
