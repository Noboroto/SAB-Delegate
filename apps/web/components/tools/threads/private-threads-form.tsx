'use client';

import { Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import {
  parseSnowflakes,
  PRIVATE_THREAD_MAX_MEMBERS,
  PRIVATE_THREAD_PREFIX_MAX_LENGTH,
  PrivateThreadCreateSchema,
  PrivateThreadResultSchema,
  MESSAGE_MAX_LENGTH,
  type PrivateThreadResult,
} from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { RoleSelect } from '@/components/forms/role-select';
import { buildRequest } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useUnsavedText } from '@/lib/tools/use-unsaved-text';
import { useWriteDone } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { ValidatedAction } from '../shared/validated-action';
import { PRIVATE_THREAD_PARENT_TYPES } from './thread-channel-types';
import { PrivateThreadPlanView, type PrivateThreadPlan } from './private-thread-plan';
import { PrivateThreadResultView } from './private-thread-result';

interface Values {
  channelId?: string;
  prefix?: string;
  message?: string;
  userIds?: string;
  roleId?: string;
}

/** Opens one private thread per member, named after the member, and posts the same first message in each. */
export function PrivateThreadsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const done = useWriteDone();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const ids = parseSnowflakes(values.userIds ?? '');
  const markSent = useUnsavedText(values.message);

  const request = buildRequest(PrivateThreadCreateSchema, {
    channelId: values.channelId,
    prefix: values.prefix,
    message: values.message,
    userIds: ids,
    roleId: values.roleId,
  });
  const [result, record] = useRunOutcome<PrivateThreadResult>(
    request === undefined ? undefined : JSON.stringify(request),
  );

  const plan = (): Promise<PrivateThreadPlan> => {
    if (request === undefined) return Promise.reject(new Error('The form is not valid.'));
    return Promise.resolve({
      channelId: request.channelId,
      prefix: request.prefix,
      message: request.message,
      memberCount: new Set(request.userIds).size,
      roleId: request.roleId,
      emoji: undefined,
    });
  };

  return (
    <ToolCard description={t('threads.private.description')}>
      <Form form={form} layout="vertical">
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
          dependencies={['roleId']}
          extra={t('threads.private.userIdsHelp', {
            count: ids.length,
            max: PRIVATE_THREAD_MAX_MEMBERS,
          })}
          rules={[
            {
              validator: () => {
                if (ids.length > PRIVATE_THREAD_MAX_MEMBERS) {
                  return Promise.reject(
                    new Error(
                      t('threads.private.tooManyMembers', {
                        count: ids.length,
                        max: PRIVATE_THREAD_MAX_MEMBERS,
                      }),
                    ),
                  );
                }
                return ids.length > 0 || values.roleId !== undefined
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('threads.private.membersRequired')));
              },
            },
          ]}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
        </Form.Item>
        <Form.Item name="roleId" label={t('threads.private.roleLabel')}>
          <RoleSelect guildId={guildId} allowClear />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <ValidatedAction form={form} valid={request !== undefined}>
            <ConfirmAction
              danger={false}
              label={t('threads.private.previewLabel')}
              modalTitle={t('threads.private.modalTitle')}
              confirmLabel={t('threads.private.submit')}
              preview={plan}
              execute={() => {
                if (request === undefined)
                  return Promise.reject(new Error('The form is not valid.'));
                return postTool(guildId, 'threads/private', request, PrivateThreadResultSchema);
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
