'use client';

import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import {
  THREAD_MESSAGE_MAX_LENGTH,
  THREAD_NAME_MAX_LENGTH,
  ThreadCreateRequestSchema,
  ThreadCreateResultSchema,
  type ThreadCreateStatus,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ResultBlock } from '@/components/ui/result-block';
import { buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useUnsavedText } from '@/lib/tools/use-unsaved-text';
import { useRequiredRule } from '../shared/fields';
import { TextBlock } from '../shared/text-block';
import { ToolCard } from '../shared/tool-card';
import { THREAD_PARENT_TYPES } from './thread-channel-types';

interface Values {
  channelId: string;
  name: string;
  message: string;
  isPrivate?: boolean;
}

/** Opens a thread with its first message. */
export function CreateThreadForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const isPrivate: boolean | undefined = Form.useWatch('isPrivate', form);
  const markSent = useUnsavedText(Form.useWatch('message', form));
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'threads', body, ThreadCreateResultSchema),
  );
  const statusText: Record<ThreadCreateStatus, string> = {
    CREATED: t('threads.create.status.CREATED'),
    CHANNEL_CANNOT_HOLD_THREADS: t('threads.create.status.CHANNEL_CANNOT_HOLD_THREADS'),
    PRIVATE_NEEDS_TEXT_CHANNEL: t('threads.create.status.PRIVATE_NEEDS_TEXT_CHANNEL'),
  };

  const onFinish = async (values: Values) => {
    const outcome = await action.submit(
      buildRequest(ThreadCreateRequestSchema, {
        channelId: values.channelId,
        name: values.name,
        message: values.message,
        isPrivate: values.isPrivate === true,
      }),
      { refresh: true, success: t('threads.create.done') },
    );
    if (outcome?.ok === true) markSent(values.message);
  };

  return (
    <ToolCard description={t('threads.create.description')}>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => void onFinish(values)}
        onValuesChange={action.clear}
      >
        <Form.Item name="channelId" label={t('threads.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={THREAD_PARENT_TYPES} />
        </Form.Item>
        <Form.Item
          name="name"
          label={t('threads.create.nameLabel')}
          rules={[{ required: true, whitespace: true, message: t('common.required') }]}
        >
          <Input maxLength={THREAD_NAME_MAX_LENGTH} />
        </Form.Item>
        <Form.Item
          name="message"
          label={t('threads.create.messageLabel')}
          rules={[{ required: true, whitespace: true, message: t('common.required') }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 10 }}
            maxLength={THREAD_MESSAGE_MAX_LENGTH}
          />
        </Form.Item>
        <Form.Item name="isPrivate" valuePropName="checked" extra={t('threads.create.privateHelp')}>
          <Checkbox>{t('threads.create.privateLabel')}</Checkbox>
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={action.pending}>
            {t(isPrivate === true ? 'threads.create.submitPrivate' : 'threads.create.submit')}
          </Button>
        </Form.Item>
      </Form>
      {action.error === undefined ? null : (
        <ResultBlock>
          <ErrorAlert error={action.error} />
        </ResultBlock>
      )}
      {action.result === undefined ? null : (
        <ResultBlock>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Alert
              type={action.result.status === 'CREATED' ? 'success' : 'info'}
              showIcon
              title={statusText[action.result.status]}
            />
            {action.result.threadId === null ? null : (
              <TextBlock text={action.result.threadId} copyLabel={t('common.copyThreadId')} />
            )}
          </div>
        </ResultBlock>
      )}
    </ToolCard>
  );
}
