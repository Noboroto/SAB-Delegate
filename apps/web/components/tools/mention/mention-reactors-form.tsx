'use client';

import { Button, Checkbox, Form, Input } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import {
  MENTION_CONTENT_MAX_LENGTH,
  MentionReactorsRequestSchema,
  MentionResultSchema,
  toSupportedLocale,
} from '@sab/shared';
import { blankToUndefined, buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { ErrorAlert } from '@/components/data/error-alert';
import { EmojiItem, MessageRefItem } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { MentionResultView } from './mention-result-view';

interface Values {
  message: string;
  emoji: string;
  content?: string;
  post?: boolean;
}

/** Lists everyone who reacted to a message with one emoji; posting the list is opt-in. */
export function MentionReactorsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const locale = toSupportedLocale(useLocale());
  const [form] = Form.useForm<Values>();
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'mention/reactors', body, MentionResultSchema),
  );

  const onFinish = (values: Values) => {
    const ref = readMessageRef(values.message);
    const posting = values.post === true;
    return action.submit(
      ref === undefined
        ? undefined
        : buildRequest(MentionReactorsRequestSchema, {
            ...ref,
            emoji: values.emoji,
            content: blankToUndefined(values.content),
            replyTo: posting ? ref : undefined,
            locale,
          }),
      posting ? { refresh: true, success: t('mention.posted') } : {},
    );
  };

  return (
    <ToolCard title={t('mention.reactors.title')} description={t('mention.reactors.description')}>
      <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)}>
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
        <Button type="primary" htmlType="submit" loading={action.pending}>
          {t('mention.submit')}
        </Button>
      </Form>
      {action.error === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={action.error} />
        </div>
      )}
      {action.result === undefined ? null : <MentionResultView result={action.result} />}
    </ToolCard>
  );
}
