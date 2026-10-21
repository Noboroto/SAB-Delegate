'use client';

import { Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import {
  MESSAGE_MAX_LENGTH,
  PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  PrivateThreadFromReactorsSchema,
  PrivateThreadResultSchema,
  ReactorIdsResultSchema,
  type PrivateThreadResult,
} from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { getTool, postTool } from '@/lib/tools/tool-api';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useUnsavedText } from '@/lib/tools/use-unsaved-text';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { EmojiItem, MessageRefItem, useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { ValidatedAction } from '../shared/validated-action';
import { PRIVATE_THREAD_PARENT_TYPES } from './thread-channel-types';
import { PrivateThreadPlanView, type PrivateThreadPlan } from './private-thread-plan';
import { PrivateThreadResultView } from './private-thread-result';

interface Values {
  channelId?: string;
  prefix?: string;
  message?: string;
  messageLink?: string;
  emoji?: string;
}

/** Opens a private thread for everyone who reacted to a message with one emoji. */
export function PrivateReactorsThreadsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const done = useWriteDone();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const markSent = useUnsavedText(values.message);

  const request = buildRequest(PrivateThreadFromReactorsSchema, values);
  const ref = readMessageRef(values.messageLink);
  const valid = request !== undefined && ref !== undefined;
  const [result, record] = useRunOutcome<PrivateThreadResult>(
    request === undefined ? undefined : JSON.stringify(request),
  );

  // The reactors are read with the lookup route the "who reacted" tool uses, so
  // the person sees how many threads this will open before anything is posted.
  const plan = async (): Promise<PrivateThreadPlan> => {
    if (request === undefined || ref === undefined) throw new Error('The form is not valid.');
    // The count is only shown, never a gate: the run itself reads the reactors
    // again, so a failed count must not stop what the bot always allowed.
    const memberCount = await getTool(
      guildId,
      'info/reactors',
      { channelId: ref.channelId, messageId: ref.messageId, emoji: request.emoji },
      ReactorIdsResultSchema,
    ).then(
      (reactors) => reactors.userIds.length,
      () => undefined,
    );
    return {
      channelId: request.channelId,
      prefix: request.prefix,
      message: request.message,
      memberCount,
      roleId: undefined,
      emoji: request.emoji,
    };
  };

  return (
    <ToolCard description={t('threads.privateReactors.description')}>
      <Form form={form} layout="vertical">
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
        <Form.Item style={{ marginBottom: 0 }}>
          <ValidatedAction form={form} valid={valid}>
            <ConfirmAction
              danger={false}
              label={t('threads.private.previewLabel')}
              modalTitle={t('threads.private.modalTitle')}
              confirmLabel={t('threads.private.submit')}
              preview={plan}
              execute={() => {
                if (request === undefined)
                  return Promise.reject(new Error('The form is not valid.'));
                return postTool(
                  guildId,
                  'threads/private/reactors',
                  request,
                  PrivateThreadResultSchema,
                );
              }}
              renderPlan={(shown) => <PrivateThreadPlanView guildId={guildId} plan={shown} />}
              onDone={(outcome) => {
                record(outcome);
                markSent(values.message);
                done(t('threads.private.done'));
              }}
            />
          </ValidatedAction>
        </Form.Item>
      </Form>
      {result === undefined ? null : <PrivateThreadResultView result={result} />}
    </ToolCard>
  );
}
