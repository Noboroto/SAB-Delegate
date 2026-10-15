'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Card, Form, Input, Select, Switch } from 'antd';
import { useTranslations } from 'next-intl';
import {
  LlmBaseUrlSchema,
  type LlmSettings,
  type LlmSettingsInput,
  type LlmTestResult,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { saveLlmSettings, testLlmSettings } from '@/lib/llm/llm-api';

const PRESETS = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  {
    value: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { value: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
] as const;

const CUSTOM = 'custom';

interface LlmFormValues {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

/** The preset whose address is `baseUrl`, else the custom entry. */
function presetOf(baseUrl: string | undefined): string {
  const address = (baseUrl ?? '').trim();
  return PRESETS.find((preset) => preset.baseUrl === address)?.value ?? CUSTOM;
}

export function LlmSettingsForm({ guildId, settings }: { guildId: string; settings: LlmSettings }) {
  const t = useTranslations('web-settings');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<LlmFormValues>();
  const [testResult, setTestResult] = useState<LlmTestResult | undefined>(undefined);
  const baseUrl = Form.useWatch('baseUrl', form) as string | undefined;
  const disabled = !settings.available;

  const save = useApiMutation((input: LlmSettingsInput) => saveLlmSettings(guildId, input));
  const test = useApiMutation((input: LlmSettingsInput) => testLlmSettings(guildId, input));
  const busy = save.pending || test.pending;

  // A stored key never goes to a new host, so a new address needs a new key.
  const keyRequired = (address: string | undefined) =>
    settings.keyLast4 === null || (address ?? '').trim() !== settings.baseUrl;

  const toInput = (values: LlmFormValues): LlmSettingsInput => {
    const apiKey = values.apiKey.trim();
    return {
      baseUrl: values.baseUrl.trim(),
      model: values.model.trim(),
      enabled: values.enabled,
      ...(apiKey === '' ? {} : { apiKey }),
    };
  };

  const onSave = async (values: LlmFormValues) => {
    setTestResult(undefined);
    const outcome = await save.run(toInput(values));
    if (outcome?.ok !== true) return;
    // The key typed is stored now; it must not ride along on the next save.
    form.setFieldValue('apiKey', '');
    void message.success(t('llm.form.saved'));
    router.refresh();
  };

  const onTest = async () => {
    const values = await form.validateFields().catch(() => undefined);
    if (values === undefined) return;
    setTestResult(undefined);
    const outcome = await test.run(toInput(values));
    if (outcome?.ok === true) setTestResult(outcome.data);
  };

  const failure = save.error ?? test.error;

  return (
    <Card>
      <Form<LlmFormValues>
        form={form}
        layout="vertical"
        disabled={disabled || busy}
        initialValues={{
          baseUrl: settings.baseUrl ?? '',
          model: settings.model ?? '',
          apiKey: '',
          enabled: settings.enabled,
        }}
        onValuesChange={() => {
          setTestResult(undefined);
          save.reset();
          test.reset();
        }}
        onFinish={(values) => void onSave(values)}
      >
        {disabled ? (
          <Alert
            type="info"
            showIcon
            title={t('llm.form.unavailable')}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form.Item label={t('llm.form.preset')} htmlFor="llm-preset">
          <Select
            id="llm-preset"
            value={presetOf(baseUrl)}
            options={[
              ...PRESETS.map(({ value, label }) => ({ value, label })),
              { value: CUSTOM, label: t('llm.form.presetCustom') },
            ]}
            onChange={(value) => {
              const preset = PRESETS.find((candidate) => candidate.value === value);
              if (preset === undefined) return;
              form.setFieldValue('baseUrl', preset.baseUrl);
              void form.validateFields(['baseUrl', 'apiKey']).catch(() => undefined);
              // setFieldValue does not fire onValuesChange, which clears these.
              setTestResult(undefined);
              save.reset();
              test.reset();
            }}
          />
        </Form.Item>
        <Form.Item
          name="baseUrl"
          label={t('llm.form.baseUrl')}
          extra={t('llm.form.baseUrlHelp')}
          rules={[
            {
              validator: (_rule, value: string | undefined) =>
                LlmBaseUrlSchema.safeParse(value ?? '').success
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('llm.form.baseUrlInvalid'))),
            },
          ]}
        >
          <Input inputMode="url" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="model"
          label={t('llm.form.model')}
          rules={[{ required: true, whitespace: true, message: t('llm.form.modelRequired') }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="apiKey"
          label={t('llm.form.apiKey')}
          extra={t('llm.form.apiKeyHelp')}
          dependencies={['baseUrl']}
          rules={[
            {
              validator: (_rule, value: string | undefined) =>
                !keyRequired(form.getFieldValue('baseUrl') as string | undefined) ||
                (value ?? '').trim() !== ''
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('llm.form.apiKeyRequired'))),
            },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={settings.keyLast4 === null ? undefined : `•••• ${settings.keyLast4}`}
          />
        </Form.Item>
        <Form.Item name="enabled" label={t('llm.form.enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        {testResult === undefined ? null : (
          <Form.Item>
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              title={
                testResult.ok
                  ? t('llm.form.testOk')
                  : t(`llm.form.testReasons.${testResult.reason ?? 'bad_response'}`)
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
              disabled={disabled || save.pending}
            >
              {t('llm.form.test')}
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={save.pending}
              disabled={disabled || test.pending}
            >
              {t('llm.form.save')}
            </Button>
          </ActionRow>
        </Form.Item>
      </Form>
    </Card>
  );
}
