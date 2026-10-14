'use client';

import { Button, Form } from 'antd';
import { useTranslations } from 'next-intl';
import { ReactorIdsQuerySchema, ReactorIdsResultSchema } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { getTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { EmojiItem, MessageRefItem } from '../shared/fields';
import { IdList } from '../shared/id-list';
import { ToolCard } from '../shared/tool-card';

interface Values {
  message: string;
  emoji: string;
}

/** The ids of everyone who reacted to a message with one emoji (bots left out). */
export function ReactorsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const [form] = Form.useForm<Values>();
  const action = useToolRun((query: { channelId: string; messageId: string; emoji: string }) =>
    getTool(guildId, 'info/reactors', query, ReactorIdsResultSchema),
  );

  const onFinish = (values: Values) => {
    const ref = readMessageRef(values.message);
    return action.submit(
      ref === undefined
        ? undefined
        : buildRequest(ReactorIdsQuerySchema, { ...ref, emoji: values.emoji }),
    );
  };

  return (
    <ToolCard title={t('info.reactors.title')} description={t('info.reactors.description')}>
      <Form form={form} layout="vertical" onFinish={(values) => void onFinish(values)}>
        <MessageRefItem name="message" label={t('info.messageLabel')} />
        <EmojiItem name="emoji" label={t('info.emojiLabel')} />
        <Button type="primary" htmlType="submit" loading={action.pending}>
          {t('info.reactors.submit')}
        </Button>
      </Form>
      {action.error === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={action.error} />
        </div>
      )}
      {action.result === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <IdList title={t('info.reactors.listTitle')} ids={action.result.userIds} />
        </div>
      )}
    </ToolCard>
  );
}
