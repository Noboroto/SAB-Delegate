'use client';

import { useState } from 'react';
import { Alert, App, Button, Card, Form, Input, InputNumber, Switch, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  EMAIL_ADDRESS_MAX,
  SmtpSettingsInputSchema,
  type SmtpSettings,
  type SmtpSettingsInput,
  type SmtpTestResult,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { saveSmtpSettings, testSmtpSettings } from '@/lib/email-verify/email-verify-api';

interface SmtpValues {
  host: string;
  port: number | null;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  enabled: boolean;
}

const SMTP_FIELDS: readonly (keyof SmtpValues)[] = [
  'host',
  'port',
  'secure',
  'username',
  'password',
  'fromAddress',
  'fromName',
  'enabled',
];

/** Whether the form holds anything the saved account does not (a typed password always counts). */
function differsFromSaved(values: SmtpValues | undefined, saved: SmtpSettings): boolean {
  if (values === undefined) return false;
  return (
    values.host.trim() !== saved.host ||
    values.port !== saved.port ||
    values.secure !== saved.secure ||
    values.username.trim() !== saved.username ||
    values.password !== '' ||
    values.fromAddress.trim().toLowerCase() !== saved.fromAddress.toLowerCase() ||
    (values.fromName.trim() === '' ? null : values.fromName.trim()) !== saved.fromName ||
    values.enabled !== saved.enabled
  );
}

/** The mail server may only be used with the password it was saved with: a new host needs it typed again. */
function hostChangedWithoutPassword(values: SmtpValues, saved: SmtpSettings): boolean {
  return (
    saved.passwordSet &&
    values.password === '' &&
    values.host.trim().toLowerCase() !== saved.host.toLowerCase()
  );
}

/** The one SMTP account the bot mails from; shown in the admin server only. The password is write-only. */
export function SmtpCard({ guildId, settings }: { guildId: string; settings: SmtpSettings }) {
  const t = useTranslations('web-email-verify.smtp');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<SmtpValues>();
  const [testResult, setTestResult] = useState<SmtpTestResult | undefined>(undefined);
  const disabled = !settings.available;

  const save = useApiMutation((input: SmtpSettingsInput) => saveSmtpSettings(guildId, input));
  // The server tests the saved account only, so there is nothing to send with the request.
  const test = useApiMutation(() => testSmtpSettings(guildId));
  const watched = Form.useWatch([], form);
  const unsaved = differsFromSaved(watched, settings);
  const busy = save.pending || test.pending;

  // The shared schema is the one check; a field it refuses is marked on the form with a sentence.
  const toInput = (values: SmtpValues): SmtpSettingsInput | undefined => {
    if (hostChangedWithoutPassword(values, settings)) {
      form.setFields([{ name: 'password', errors: [t('errors.passwordAgain')] }]);
      return undefined;
    }
    const parsed = SmtpSettingsInputSchema.safeParse({
      host: values.host,
      port: values.port,
      secure: values.secure,
      username: values.username,
      ...(values.password === '' ? {} : { password: values.password }),
      fromAddress: values.fromAddress,
      fromName: values.fromName.trim() === '' ? null : values.fromName,
      enabled: values.enabled,
    });
    if (parsed.success) return parsed.data;
    const marked = new Map<keyof SmtpValues, string>();
    for (const issue of parsed.error.issues) {
      const field = SMTP_FIELDS.find((name) => name === issue.path[0]);
      if (field === undefined || marked.has(field)) continue;
      const value = values[field];
      const empty = value === null || value === undefined || value === '';
      marked.set(field, t(empty ? 'errors.required' : 'errors.invalid'));
    }
    form.setFields([...marked].map(([name, message]) => ({ name, errors: [message] })));
    return undefined;
  };

  const onSave = async (values: SmtpValues) => {
    const input = toInput(values);
    if (input === undefined) return;
    setTestResult(undefined);
    const outcome = await save.run(input);
    if (outcome?.ok !== true) return;
    // The password typed is stored now; it must not ride along on the next save.
    form.setFieldValue('password', '');
    void message.success(t('saved'));
    router.refresh();
  };

  const onTest = async () => {
    setTestResult(undefined);
    const outcome = await test.run(undefined);
    if (outcome?.ok === true) setTestResult(outcome.data);
  };

  const failure = save.error ?? test.error;

  return (
    <Card title={t('title')}>
      <Form<SmtpValues>
        form={form}
        layout="vertical"
        disabled={disabled || busy}
        initialValues={{
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          username: settings.username,
          password: '',
          fromAddress: settings.fromAddress,
          fromName: settings.fromName ?? '',
          enabled: settings.enabled,
        }}
        onValuesChange={() => {
          setTestResult(undefined);
          save.reset();
          test.reset();
        }}
        onFinish={(values) => void onSave(values)}
      >
        <Alert type="info" showIcon title={t('intro')} style={{ marginBottom: 'var(--space-4)' }} />
        {disabled ? (
          <Alert
            type="warning"
            showIcon
            title={t('unavailable')}
            style={{ marginBottom: 'var(--space-4)' }}
          />
        ) : null}
        <Form.Item name="host" label={t('host')}>
          <Input autoComplete="off" maxLength={253} />
        </Form.Item>
        <Form.Item name="port" label={t('port')}>
          <InputNumber min={1} max={65535} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="secure" label={t('secure')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="username" label={t('username')}>
          <Input autoComplete="off" maxLength={320} />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('password')}
          extra={`${t('passwordHelp')} ${settings.passwordSet ? t('passwordSet') : t('passwordNotSet')}`}
        >
          <Input.Password
            autoComplete="new-password"
            maxLength={500}
            placeholder={settings.passwordSet ? t('passwordUnchanged') : undefined}
          />
        </Form.Item>
        <Form.Item name="fromAddress" label={t('fromAddress')} extra={t('fromAddressHelp')}>
          <Input type="email" autoComplete="off" maxLength={EMAIL_ADDRESS_MAX} />
        </Form.Item>
        <Form.Item name="fromName" label={t('fromName')}>
          <Input autoComplete="off" maxLength={100} />
        </Form.Item>
        <Form.Item name="enabled" label={t('enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        {testResult === undefined ? null : (
          <Form.Item>
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              title={
                testResult.ok ? t('testOk') : t(`testFailed.${testResult.reason ?? 'unreachable'}`)
              }
            />
          </Form.Item>
        )}
        {failure === undefined ? null : (
          <Form.Item>
            <ErrorAlert error={failure} />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <ActionRow>
            <Button
              onClick={() => void onTest()}
              loading={test.pending}
              disabled={disabled || save.pending || unsaved}
            >
              {t('test')}
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={save.pending}
              disabled={disabled || test.pending}
            >
              {t('save')}
            </Button>
            {unsaved ? <Typography.Text type="secondary">{t('saveFirst')}</Typography.Text> : null}
          </ActionRow>
        </Form.Item>
      </Form>
    </Card>
  );
}
