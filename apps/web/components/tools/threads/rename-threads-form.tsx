'use client';

import { Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import { THREAD_NAME_MAX_LENGTH, ThreadRenameRequestSchema } from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { buildRequest } from '@/lib/tools/build-request';
import { useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { THREAD_PARENT_TYPES } from './thread-channel-types';
import { ThreadBatchRunner } from './thread-batch-runner';

interface Values {
  channelId?: string;
  oldPrefix?: string;
  newPrefix?: string;
}

/** Replaces the start of the name of every active thread in a channel that has a given prefix. */
export function RenameThreadsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};

  return (
    <ToolCard description={t('threads.rename.description')}>
      <Form form={form} layout="vertical">
        <Form.Item name="channelId" label={t('threads.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={THREAD_PARENT_TYPES} />
        </Form.Item>
        <Form.Item
          name="oldPrefix"
          label={t('threads.rename.oldPrefixLabel')}
          extra={t('threads.prefixHelp')}
        >
          <Input maxLength={THREAD_NAME_MAX_LENGTH} />
        </Form.Item>
        <Form.Item
          name="newPrefix"
          label={t('threads.rename.newPrefixLabel')}
          extra={t('threads.rename.newPrefixHelp')}
        >
          <Input maxLength={THREAD_NAME_MAX_LENGTH} />
        </Form.Item>
      </Form>
      <ThreadBatchRunner
        guildId={guildId}
        form={form}
        path="threads/rename"
        label={t('threads.rename.label')}
        modalTitle={t('threads.rename.modalTitle')}
        confirmLabel={t('threads.rename.confirm')}
        doneText={t('threads.rename.done')}
        build={(flags) =>
          buildRequest(ThreadRenameRequestSchema, {
            channelId: values.channelId,
            oldPrefix: values.oldPrefix,
            newPrefix: values.newPrefix ?? '',
            ...flags,
          })
        }
      />
    </ToolCard>
  );
}
