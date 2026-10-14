'use client';

import { App, Alert, Descriptions, Form, Input } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MESSAGE_MAX_LENGTH, type SendMessageResult } from '@sab/shared';
import { ChannelSelect } from '@/components/forms/channel-select';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { sendMessage } from '@/lib/messaging/messaging-api';
import { useFormValues } from '@/lib/messaging/use-form-values';
import { buildSend, refProblem, requireBuilt } from '@/lib/messaging/requests';
import { ChannelLabel } from './channel-label';
import { MessagePreview } from './message-preview';
import { MessageRefItem } from './message-ref-item';

interface Values {
  channelId?: string;
  content?: string;
  replyTo?: string;
}

/** Posts a message as the bot. The service previews it first, and only the person's confirmation posts it. */
export function SendMessageForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-messaging');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const values = useFormValues(form);
  const request = buildSend(values);

  return (
    <Form form={form} layout="vertical">
      <Form.Item name="channelId" label={t('fields.channel')}>
        <ChannelSelect guildId={guildId} types={TEXT_CHANNEL_TYPES} />
      </Form.Item>
      <Form.Item name="content" label={t('fields.content')}>
        <Input.TextArea rows={5} maxLength={MESSAGE_MAX_LENGTH} showCount />
      </Form.Item>
      <MessageRefItem
        name="replyTo"
        label={t('send.replyTo')}
        problem={refProblem(values.replyTo)}
      />
      <Form.Item style={{ marginBottom: 0 }}>
        <ConfirmAction
          danger={false}
          label={t('send.action')}
          modalTitle={t('send.modalTitle')}
          confirmLabel={t('send.confirm')}
          disabled={!request.ok}
          preview={() => sendMessage(guildId, requireBuilt(request), true)}
          execute={() => sendMessage(guildId, requireBuilt(request), false)}
          renderPlan={(plan: SendMessageResult) => (
            <>
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'channel',
                    label: t('fields.channel'),
                    children: <ChannelLabel guildId={guildId} channelId={plan.channelId} />,
                  },
                  ...(plan.replyToMessageId === null
                    ? []
                    : [
                        {
                          key: 'reply',
                          label: t('send.replyTo'),
                          children: plan.replyToMessageId,
                        },
                      ]),
                ]}
              />
              <MessagePreview content={plan.content} />
              {plan.pings.length === 0 ? null : (
                <Alert
                  style={{ marginTop: 12 }}
                  type="warning"
                  showIcon
                  title={t('send.pings', { list: plan.pings.join(', ') })}
                />
              )}
            </>
          )}
          onDone={() => {
            void message.success(t('send.done'));
            form.resetFields();
            router.refresh();
          }}
        />
      </Form.Item>
    </Form>
  );
}
