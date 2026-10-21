'use client';

import { Button, Checkbox, Form, Input } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import {
  MENTION_CONTENT_MAX_LENGTH,
  MentionReactorsRequestSchema,
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
import { ResultBlock } from '@/components/ui/result-block';
import { EmojiItem, MessageRefItem } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { MentionPostAction } from './mention-post-action';
import { MentionResultView } from './mention-result-view';

interface Values {
  message?: string;
  emoji?: string;
  content?: string;
  post?: boolean;
}

/** Lists everyone who reacted to a message with one emoji; posting the list is opt-in. */
export function MentionReactorsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const locale = toSupportedLocale(useLocale());
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const markSent = useUnsavedText(values.content);
  const posting = values.post === true;
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'mention/reactors', body, MentionResultSchema),
  );

  const build = (dryRun: boolean) => {
    const ref = readMessageRef(values.message);
    return ref === undefined
      ? undefined
      : buildRequest(MentionReactorsRequestSchema, {
          ...ref,
          emoji: values.emoji,
          content: blankToUndefined(values.content),
          replyTo: posting ? ref : undefined,
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
    <ToolCard title={t('mention.reactors.title')} description={t('mention.reactors.description')}>
      <Form
        form={form}
        layout="vertical"
        onFinish={() => void onFinish()}
        onValuesChange={action.clear}
      >
        <MessageRefItem name="message" label={t('mention.messageLabel')} />
        <EmojiItem name="emoji" label={t('mention.emojiLabel')} />
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
        <Form.Item name="post" valuePropName="checked">
          <Checkbox>{t('mention.postLabel')}</Checkbox>
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          {posting ? (
            <MentionPostAction
              guildId={guildId}
              form={form}
              path="mention/reactors"
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
