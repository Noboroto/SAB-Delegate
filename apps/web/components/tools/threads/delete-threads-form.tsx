'use client';

import { Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import { THREAD_NAME_MAX_LENGTH, ThreadDeleteRequestSchema } from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { buildRequest } from '@/lib/tools/build-request';
import { useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { THREAD_PARENT_TYPES } from './thread-channel-types';
import { ThreadBatchRunner } from './thread-batch-runner';

interface Values {
  channelId?: string;
  prefix?: string;
}

/** Deletes every active thread in a channel whose name starts with a given prefix. */
export function DeleteThreadsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};

  return (
    <ToolCard description={t('threads.delete.description')}>
      <Form form={form} layout="vertical">
        <Form.Item name="channelId" label={t('threads.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={THREAD_PARENT_TYPES} />
        </Form.Item>
        <Form.Item
          name="prefix"
          label={t('threads.delete.prefixLabel')}
          extra={t('threads.prefixHelp')}
        >
          <Input maxLength={THREAD_NAME_MAX_LENGTH} />
        </Form.Item>
      </Form>
      <ThreadBatchRunner
        guildId={guildId}
        form={form}
        path="threads/delete"
        label={t('threads.delete.label')}
        modalTitle={t('threads.delete.modalTitle')}
        confirmLabel={t('threads.delete.confirm')}
        doneText={t('threads.delete.done')}
        build={(flags) =>
          buildRequest(ThreadDeleteRequestSchema, {
            channelId: values.channelId,
            prefix: values.prefix,
            ...flags,
          })
        }
      />
    </ToolCard>
  );
}
