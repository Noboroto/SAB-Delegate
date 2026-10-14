'use client';

import { Button, Checkbox, Collapse, Form, Input } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import {
  MENTION_CONTENT_MAX_LENGTH,
  MentionNonReactorsRequestSchema,
  MentionResultSchema,
  toSupportedLocale,
} from '@sab/shared';
import { blankToUndefined, buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { postTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { ErrorAlert } from '@/components/data/error-alert';
import { RoleSelect } from '@/components/forms/role-select';
import { MessageRefItem } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { MentionResultView } from './mention-result-view';

interface Values {
  message: string;
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
  const action = useToolRun((body: unknown) =>
    postTool(guildId, 'mention/non-reactors', body, MentionResultSchema),
  );

  const onFinish = (values: Values) => {
    const ref = readMessageRef(values.message);
    const posting = values.reply === true;
    return action.submit(
      ref === undefined
        ? undefined
        : buildRequest(MentionNonReactorsRequestSchema, {
            ...ref,
            content: blankToUndefined(values.content),
            roleId: values.roleId,
            includeBots: values.includeBots === true,
            onlyInChannel: values.onlyInChannel !== false,
            reply: posting,
            locale,
          }),
      posting ? { refresh: true, success: t('mention.posted') } : {},
    );
  };

  return (
    <ToolCard
      title={t('mention.nonReactors.title')}
      description={t('mention.nonReactors.description')}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ onlyInChannel: true }}
        onFinish={(values) => void onFinish(values)}
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
