'use client';

import { App, Button, Form } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { useApiMutation } from '@/lib/api/mutations';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { copyMessage } from '@/lib/messaging/messaging-api';
import { useFormValues } from '@/lib/messaging/use-form-values';
import { buildCopy, refProblem, requireBuilt } from '@/lib/messaging/requests';
import { MessageRefItem } from './message-ref-item';

interface Values {
  source?: string;
  channelId?: string;
}

/** Posts a copy of an existing message in another channel. */
export function CopyMessageForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-messaging');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const values = useFormValues(form);
  const request = buildCopy(values);
  const copy = useApiMutation(() => copyMessage(guildId, requireBuilt(request)));

  const submit = async () => {
    const outcome = await copy.run(undefined);
    if (outcome?.ok !== true) return;
    if (outcome.data.status === 'COPIED') {
      void message.success(t('copy.done'));
      form.resetFields();
    } else {
      void message.warning(t('copy.nothing'));
    }
    router.refresh();
  };

  return (
    <Form form={form} layout="vertical" disabled={copy.pending} onFinish={() => void submit()}>
      <MessageRefItem name="source" label={t('copy.source')} problem={refProblem(values.source)} />
      <Form.Item name="channelId" label={t('copy.channel')}>
        <ChannelSelect guildId={guildId} types={TEXT_CHANNEL_TYPES} />
      </Form.Item>
      {copy.error === undefined ? null : (
        <Form.Item>
          <ErrorAlert error={copy.error} />
        </Form.Item>
      )}
      <Form.Item style={{ marginBottom: 0 }}>
        <Button type="primary" htmlType="submit" loading={copy.pending} disabled={!request.ok}>
          {t('copy.action')}
        </Button>
      </Form.Item>
    </Form>
  );
}
