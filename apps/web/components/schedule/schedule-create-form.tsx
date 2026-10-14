'use client';

import { App, Button, Card, Form, Input, Segmented } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MESSAGE_MAX_LENGTH, formatWhenIct } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { useApiMutation } from '@/lib/api/mutations';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { readMessageRef } from '@/lib/messaging/requests';
import { useFormValues } from '@/lib/messaging/use-form-values';
import { createSchedule } from '@/lib/schedule/schedule-api';
import { errorField, resolveRunAt, type RunAtError } from '@/lib/schedule/run-at';

type Kind = 'send' | 'copy';

interface Values {
  kind: Kind;
  channelId?: string;
  content?: string;
  source?: string;
  date?: string;
  time?: string;
}

type CreateVars =
  | { kind: 'send'; channelId: string; content: string; runAt: string }
  | { kind: 'copy'; channelId: string; source: string; runAt: string };

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Schedules a message for later. Everything the server would refuse is caught on the fields first. */
export function ScheduleCreateForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-schedule');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const kind = useFormValues(form).kind ?? 'send';
  const create = useApiMutation(({ runAt, ...fields }: CreateVars) =>
    createSchedule(guildId, fields, runAt),
  );

  const errors: Record<RunAtError, string> = {
    TIME_REQUIRED: t('create.errors.timeRequired'),
    INVALID_TIME: t('create.errors.invalidTime'),
    INVALID_DATE: t('create.errors.invalidDate'),
    NONEXISTENT_DATE: t('create.errors.nonexistentDate'),
    RELATIVE_WITH_DATE: t('create.errors.relativeWithDate'),
    PAST: t('create.errors.past'),
    TOO_FAR: t('create.errors.tooFar'),
  };

  /** A rule that fails only when the problem belongs on `field`; the other field's rule reports the rest. */
  const whenRule = (field: 'date' | 'time') => ({
    validator: () => {
      const date = textOf(form.getFieldValue('date'));
      const time = textOf(form.getFieldValue('time'));
      // A date alone is judged against the end of its day: "today" is fine until midnight.
      if (field === 'date' && date.trim() === '') return Promise.resolve();
      const result = resolveRunAt(
        date,
        field === 'date' && time.trim() === '' ? '23:59:59' : time,
        new Date(),
      );
      if (result.ok || errorField(result.error) !== field) return Promise.resolve();
      return Promise.reject(new Error(errors[result.error]));
    },
  });

  const submit = async (values: Values) => {
    const runAt = resolveRunAt(values.date ?? '', values.time ?? '', new Date());
    if (!runAt.ok || values.channelId === undefined) return;
    const vars: CreateVars =
      values.kind === 'copy'
        ? {
            kind: 'copy',
            channelId: values.channelId,
            source: (values.source ?? '').trim(),
            runAt: runAt.iso,
          }
        : {
            kind: 'send',
            channelId: values.channelId,
            content: values.content ?? '',
            runAt: runAt.iso,
          };
    const outcome = await create.run(vars);
    if (outcome === undefined) return;
    if (!outcome.ok) {
      // No readable answer: the message may have been queued, so re-read the list before a retry.
      if (outcome.error.status === 0) router.refresh();
      return;
    }
    void message.success(t('create.done', { when: formatWhenIct(outcome.data.runAt) }));
    form.resetFields(['content', 'source', 'date', 'time']);
    router.refresh();
  };

  return (
    <Card title={t('create.title')}>
      <Form
        form={form}
        layout="vertical"
        disabled={create.pending}
        initialValues={{ kind: 'send' }}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="kind" label={t('create.kind')}>
          <Segmented<Kind>
            options={[
              { value: 'send', label: t('create.kindSend') },
              { value: 'copy', label: t('create.kindCopy') },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="channelId"
          label={t('create.channel')}
          rules={[{ required: true, message: t('create.errors.channelRequired') }]}
        >
          <ChannelSelect guildId={guildId} types={TEXT_CHANNEL_TYPES} />
        </Form.Item>
        {kind === 'send' ? (
          <Form.Item
            name="content"
            label={t('create.content')}
            rules={[
              { required: true, whitespace: true, message: t('create.errors.contentRequired') },
            ]}
          >
            <Input.TextArea rows={4} maxLength={MESSAGE_MAX_LENGTH} showCount />
          </Form.Item>
        ) : (
          <Form.Item
            name="source"
            label={t('create.source')}
            extra={t('create.sourceHelp')}
            rules={[
              {
                validator: (_, value: unknown) =>
                  readMessageRef(textOf(value)).ok
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('create.errors.sourceInvalid'))),
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
        )}
        <div
          style={{
            display: 'grid',
            gap: '0 16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          }}
        >
          <Form.Item
            name="date"
            label={t('create.date')}
            extra={t('create.dateHelp')}
            dependencies={['time']}
            rules={[whenRule('date')]}
          >
            <Input placeholder={t('create.datePlaceholder')} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="time"
            label={t('create.time')}
            extra={t('create.timeHelp')}
            dependencies={['date']}
            rules={[whenRule('time')]}
          >
            <Input placeholder={t('create.timePlaceholder')} autoComplete="off" />
          </Form.Item>
        </div>
        {create.error === undefined ? null : (
          <Form.Item>
            <ErrorAlert error={create.error} />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={create.pending}>
            {t('create.action')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
