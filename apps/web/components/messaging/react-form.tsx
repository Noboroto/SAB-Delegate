'use client';

import { App, Button, Form, Input, InputNumber } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { POLL_CHOICES_MAX, REACTION_EMOJI_MAX_LENGTH } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { useApiMutation } from '@/lib/api/mutations';
import { reactToMessage } from '@/lib/messaging/messaging-api';
import { useFormValues } from '@/lib/messaging/use-form-values';
import { buildReact, refProblem, requireBuilt } from '@/lib/messaging/requests';
import { MessageRefItem } from './message-ref-item';

interface Values {
  target?: string;
  emoji?: string;
  pollChoices?: number | null;
}

/** Adds a reaction to a message, and optionally the numbered choices of a poll after it. */
export function ReactForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-messaging');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const values = useFormValues(form);
  const request = buildReact(values);
  const react = useApiMutation(() => reactToMessage(guildId, requireBuilt(request)));

  const submit = async () => {
    const outcome = await react.run(undefined);
    if (outcome?.ok !== true) return;
    void message.success(t('react.done', { count: outcome.data.count }));
    form.resetFields();
    router.refresh();
  };

  return (
    <Form
      form={form}
      layout="vertical"
      disabled={react.pending}
      initialValues={{ pollChoices: 0 }}
      onFinish={() => void submit()}
    >
      <MessageRefItem name="target" label={t('react.target')} problem={refProblem(values.target)} />
      <Form.Item name="emoji" label={t('react.emoji')}>
        <Input maxLength={REACTION_EMOJI_MAX_LENGTH} autoComplete="off" />
      </Form.Item>
      <Form.Item
        name="pollChoices"
        label={t('react.pollChoices')}
        extra={t('react.pollChoicesHelp')}
      >
        <InputNumber min={0} max={POLL_CHOICES_MAX} precision={0} style={{ width: '100%' }} />
      </Form.Item>
      {react.error === undefined ? null : (
        <Form.Item>
          <ErrorAlert error={react.error} />
        </Form.Item>
      )}
      <Form.Item style={{ marginBottom: 0 }}>
        <Button type="primary" htmlType="submit" loading={react.pending} disabled={!request.ok}>
          {t('react.action')}
        </Button>
      </Form.Item>
    </Form>
  );
}
