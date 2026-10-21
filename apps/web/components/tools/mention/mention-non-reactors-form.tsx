'use client';

import { Button, Checkbox, Collapse, Form, Input } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import {
  MENTION_CONTENT_MAX_LENGTH,
  MentionNonReactorsRequestSchema,
  MentionResultSchema,
  toSupportedLocale,
  type MentionResult,
} from '@sab/shared';
import { blankToUndefined, buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useRunOutcome } from '@/lib/tools/use-run-outcome';
import { useUnsavedText } from '@/lib/tools/use-unsaved-text';
import { ErrorAlert } from '@/components/data/error-alert';
import { RoleSelect } from '@/components/forms/role-select';
import { ResultBlock } from '@/components/ui/result-block';
import { MessageRefItem } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { MentionPostAction } from './mention-post-action';
import { MentionResultView } from './mention-result-view';

interface Values {
  message?: string;
  content?: string;
  roleId?: string;
  includeBots?: boolean;
  onlyInChannel?: boolean;
  reply?: boolean;
}

/** Lists the members who did not react to a message; posting the list as a reply is opt-in. */
export function MentionNonReactorsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const locale = toSupportedLocale(useLocale());
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const markSent = useUnsavedText(values.content);
  const posting = values.reply === true;
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'mention/non-reactors', body, MentionResultSchema),
  );

  const build = (dryRun: boolean) => {
    const ref = readMessageRef(values.message);
    return ref === undefined
      ? undefined
      : buildRequest(MentionNonReactorsRequestSchema, {
          ...ref,
          content: blankToUndefined(values.content),
          roleId: values.roleId,
          includeBots: values.includeBots === true,
          onlyInChannel: values.onlyInChannel !== false,
          reply: posting,
          locale,
          dryRun,
        });
  };
  const current = build(true);
  const [posted, recordPosted] = useRunOutcome<MentionResult>(
    current === undefined ? undefined : JSON.stringify(current),
  );

  const onFinish = async () => {
    // With posting ticked the only way to post is the preview-then-confirm action;
    // Enter in a field must not skip that preview and post.
    if (posting) return;
    const outcome = await action.submit(build(false));
    if (outcome?.ok === true) markSent(values.content);
  };
  const shown = action.result ?? posted;

  return (
    <ToolCard
      title={t('mention.nonReactors.title')}
      description={t('mention.nonReactors.description')}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ onlyInChannel: true }}
        onFinish={() => void onFinish()}
        onValuesChange={action.clear}
      >
        <MessageRefItem name="message" label={t('mention.messageLabel')} />
        <Form.Item
          name="content"
          label={t('mention.contentLabel')}
          extra={t('mention.contentHelp')}
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={MENTION_CONTENT_MAX_LENGTH}
          />
        </Form.Item>
        <Form.Item name="reply" valuePropName="checked">
          <Checkbox>{t('mention.replyLabel')}</Checkbox>
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: 'advanced',
              label: t('common.advanced'),
              children: (
                <>
                  <Form.Item
                    name="roleId"
                    label={t('mention.roleLabel')}
                    extra={t('mention.roleHelp')}
                  >
                    <RoleSelect guildId={guildId} allowClear />
                  </Form.Item>
                  <Form.Item name="onlyInChannel" valuePropName="checked">
                    <Checkbox>{t('mention.onlyInChannelLabel')}</Checkbox>
                  </Form.Item>
                  <Form.Item name="includeBots" valuePropName="checked">
                    <Checkbox>{t('mention.includeBotsLabel')}</Checkbox>
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
        <Form.Item style={{ marginBottom: 0 }}>
          {posting ? (
            <MentionPostAction
              guildId={guildId}
              form={form}
              path="mention/non-reactors"
              build={build}
              onPosted={(result) => {
                recordPosted(result);
                markSent(values.content);
              }}
            />
          ) : (
            <Button type="primary" htmlType="submit" loading={action.pending}>
              {t('mention.submit')}
            </Button>
          )}
        </Form.Item>
      </Form>
      {action.error === undefined ? null : (
        <ResultBlock>
          <ErrorAlert error={action.error} />
        </ResultBlock>
      )}
      {shown === undefined ? null : <MentionResultView result={shown} />}
    </ToolCard>
  );
}
