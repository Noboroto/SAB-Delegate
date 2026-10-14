'use client';

import { App, Button, Card, Form, Input, InputNumber } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BirthdayAddSchema } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { MemberSelect } from '@/components/forms/member-select';
import { useApiMutation } from '@/lib/api/mutations';
import { addBirthday } from '@/lib/birthday/birthday-api';

interface FormValues {
  studentId?: string;
  name?: string;
  discordId?: string;
  day?: number | null;
  month?: number | null;
}

type FieldName = keyof FormValues;

const FIELDS: readonly FieldName[] = ['studentId', 'name', 'discordId', 'day', 'month'];

function isField(key: unknown): key is FieldName {
  return typeof key === 'string' && (FIELDS as readonly string[]).includes(key);
}

/** One person for the list. The shared schema decides what is valid; the form only places its answers on the fields. */
export function BirthdayAddForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-birthday');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<FormValues>();
  const add = useApiMutation((entry: Parameters<typeof addBirthday>[1]) =>
    addBirthday(guildId, entry),
  );

  const submit = async (values: FormValues) => {
    const parsed = BirthdayAddSchema.safeParse(values);
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.flatMap((issue) => {
          const field = issue.path[0];
          return isField(field) ? [{ name: field, errors: [t(`validation.${field}`)] }] : [];
        }),
      );
      return;
    }
    const outcome = await add.run(parsed.data);
    if (outcome === undefined || !outcome.ok) return;
    if (outcome.data.code === 'DUPLICATE_ID') {
      form.setFields([{ name: 'studentId', errors: [t('add.duplicate')] }]);
      return;
    }
    void message.success(t('add.added', { name: parsed.data.name }));
    form.resetFields();
    router.refresh();
  };

  const required = [{ required: true, message: t('validation.required') }];

  return (
    <Card title={t('add.title')}>
      <Form<FormValues>
        form={form}
        layout="vertical"
        onFinish={(values) => void submit(values)}
        disabled={add.pending}
        requiredMark={false}
      >
        <Form.Item name="studentId" label={t('add.studentId')} rules={required}>
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item name="name" label={t('add.name')} rules={required}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="discordId" label={t('add.discordId')} rules={required}>
          <MemberSelect guildId={guildId} placeholder={t('add.discordIdPlaceholder')} />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="day" label={t('add.day')} rules={required} style={{ flex: 1 }}>
            <InputNumber min={1} max={31} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="month" label={t('add.month')} rules={required} style={{ flex: 1 }}>
            <InputNumber min={1} max={12} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        {add.error === undefined ? null : (
          <Form.Item>
            <ErrorAlert error={add.error} />
          </Form.Item>
        )}
        <Button type="primary" htmlType="submit" loading={add.pending} block>
          {t('add.submit')}
        </Button>
      </Form>
    </Card>
  );
}
