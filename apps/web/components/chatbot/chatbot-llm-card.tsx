'use client';

import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Select,
  Typography,
  theme,
} from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LlmBaseUrlSchema,
  type ChatbotConfig,
  type ChatbotLlmOverrideInput,
  type LlmTestResult,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ReauthAlert } from '@/components/auth/reauth-alert';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { LlmModelField } from '@/components/llm/llm-model-field';
import { ActionRow } from '@/components/ui/action-row';
import { LinkButton } from '@/components/ui/link-button';
import type { ApiRequestError } from '@/lib/api/api-response';
import { useApiMutation } from '@/lib/api/mutations';
import {
  clearChatbotLlm,
  listChatbotLlmModels,
  saveChatbotLlm,
  testChatbotLlm,
} from '@/lib/chatbot/chatbot-api';
import { LLM_PRESET_CUSTOM, LLM_PRESETS, presetOf } from '@/lib/llm/presets';

type Llm = ChatbotConfig['llm'];

interface LlmFormValues {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** The address' host only: the path of an API address is not worth the room, and a bad value shows as typed. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Which model answers, and the form for this server's own; "use the shared one" drops it. */
export function ChatbotLlmCard({
  guildId,
  llm,
  adminServer,
}: {
  guildId: string;
  llm: Llm;
  adminServer: boolean;
}) {
  const t = useTranslations('web-chatbot');
  const tLlm = useTranslations('web-settings');
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();
  const [form] = Form.useForm<LlmFormValues>();
  const [testResult, setTestResult] = useState<LlmTestResult | undefined>(undefined);
  const baseUrl = Form.useWatch('baseUrl', form) as string | undefined;
  const own = llm.source === 'guild';

  const save = useApiMutation((input: ChatbotLlmOverrideInput) => saveChatbotLlm(guildId, input));
  const test = useApiMutation((input: ChatbotLlmOverrideInput) => testChatbotLlm(guildId, input));
  const busy = save.pending || test.pending;

  // A stored key never goes to a new host, so a new address needs a new key.
  const keyRequired = (address: string | undefined) =>
    !own || llm.keyLast4 === null || (address ?? '').trim() !== llm.baseUrl;

  const toInput = (values: LlmFormValues): ChatbotLlmOverrideInput => {
    const apiKey = values.apiKey.trim();
    return {
      baseUrl: values.baseUrl.trim(),
      model: values.model.trim(),
      ...(apiKey === '' ? {} : { apiKey }),
    };
  };

  const resetResults = () => {
    setTestResult(undefined);
    save.reset();
    test.reset();
  };

  const onSave = async (values: LlmFormValues) => {
    setTestResult(undefined);
    const outcome = await save.run(toInput(values));
    if (outcome?.ok !== true) return;
    // The key typed is stored now; it must not ride along on the next save.
    form.setFieldValue('apiKey', '');
    void message.success(t('llm.saved'));
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
  const returnPath = `/servers/${guildId}/modules/chatbot`;
  // Changing the model's key or address needs a recent login; the sign-in is offered wherever that is refused.
  const reauthAlert = (
    <ReauthAlert
      returnPath={returnPath}
      texts={{
        title: t('reauth.title'),
        body: t('reauth.body'),
        action: t('reauth.action'),
        failed: t('reauth.failed'),
      }}
    />
  );
  const reauthOnly = (error: ApiRequestError) =>
    error.code === 'AUTH_REAUTH_REQUIRED' ? reauthAlert : undefined;
  const failureAlert = (error: ApiRequestError) =>
    reauthOnly(error) ?? <ErrorAlert error={error} />;

  return (
    <Card title={t('llm.title')}>
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: 'source', label: t('llm.source'), children: t(`llm.sources.${llm.source}`) },
          ...(llm.source === 'none' || llm.model === null
            ? []
            : [{ key: 'model', label: t('llm.model'), children: llm.model }]),
          ...(llm.source === 'none' || llm.baseUrl === null
            ? []
            : [{ key: 'host', label: t('llm.host'), children: hostOf(llm.baseUrl) }]),
          ...(!own || llm.keyLast4 === null
            ? []
            : [{ key: 'key', label: t('llm.key'), children: `•••• ${llm.keyLast4}` }]),
        ]}
      />
      {llm.source === 'none' ? (
        <Alert
          type="info"
          showIcon
          title={t('llm.noneHint')}
          style={{ marginTop: 'var(--space-3)' }}
        />
      ) : null}
      {adminServer ? (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <LinkButton href={`/servers/${guildId}/settings/llm`}>{t('llm.openGlobal')}</LinkButton>
        </div>
      ) : null}
      <Typography.Title
        level={3}
        style={{ fontSize: token.fontSizeHeading5, marginTop: 'var(--space-6)' }}
      >
        {t('llm.ownTitle')}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t('llm.ownHelp')}</Typography.Paragraph>
      <Form<LlmFormValues>
        form={form}
        layout="vertical"
        disabled={busy}
        initialValues={{
          baseUrl: own ? (llm.baseUrl ?? '') : '',
          model: own ? (llm.model ?? '') : '',
          apiKey: '',
        }}
        onValuesChange={resetResults}
        onFinish={(values) => void onSave(values)}
      >
        <Form.Item label={tLlm('llm.form.preset')} htmlFor="chatbot-llm-preset">
          <Select
            id="chatbot-llm-preset"
            value={presetOf(baseUrl)}
            options={[
              ...LLM_PRESETS.map(({ value, label }) => ({ value, label })),
              { value: LLM_PRESET_CUSTOM, label: tLlm('llm.form.presetCustom') },
            ]}
            onChange={(value) => {
              const preset = LLM_PRESETS.find((candidate) => candidate.value === value);
              if (preset === undefined) return;
              form.setFieldValue('baseUrl', preset.baseUrl);
              void form.validateFields(['baseUrl', 'apiKey']).catch(() => undefined);
              // setFieldValue does not fire onValuesChange, which clears these.
              resetResults();
            }}
          />
        </Form.Item>
        <Form.Item
          name="baseUrl"
          label={tLlm('llm.form.baseUrl')}
          extra={tLlm('llm.form.baseUrlHelp')}
          rules={[
            {
              validator: (_rule, value: string | undefined) =>
                LlmBaseUrlSchema.safeParse(value ?? '').success
                  ? Promise.resolve()
                  : Promise.reject(new Error(tLlm('llm.form.baseUrlInvalid'))),
            },
          ]}
        >
          <Input inputMode="url" autoComplete="off" />
        </Form.Item>
        <LlmModelField fetchModels={(input) => listChatbotLlmModels(guildId, input)} />
        <Form.Item
          name="apiKey"
          label={tLlm('llm.form.apiKey')}
          extra={tLlm('llm.form.apiKeyHelp')}
          dependencies={['baseUrl']}
          rules={[
            {
              validator: (_rule, value: string | undefined) =>
                !keyRequired(form.getFieldValue('baseUrl') as string | undefined) ||
                (value ?? '').trim() !== ''
                  ? Promise.resolve()
                  : Promise.reject(new Error(tLlm('llm.form.apiKeyRequired'))),
            },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder={own && llm.keyLast4 !== null ? `•••• ${llm.keyLast4}` : undefined}
          />
        </Form.Item>
        {testResult === undefined ? null : (
          <Form.Item>
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              title={
                testResult.ok
                  ? tLlm('llm.form.testOk')
                  : tLlm(`llm.form.testReasons.${testResult.reason ?? 'bad_response'}`)
              }
            />
          </Form.Item>
        )}
        {failure === undefined ? null : <Form.Item>{failureAlert(failure)}</Form.Item>}
        <Form.Item style={{ marginBottom: 0 }}>
          <ActionRow>
            <Button onClick={() => void onTest()} loading={test.pending} disabled={save.pending}>
              {tLlm('llm.form.test')}
            </Button>
            <Button type="primary" htmlType="submit" loading={save.pending} disabled={test.pending}>
              {tLlm('llm.form.save')}
            </Button>
            {own ? (
              <ConfirmAction
                label={t('llm.useShared')}
                modalTitle={t('llm.useSharedTitle')}
                confirmLabel={t('llm.useSharedConfirm')}
                disabled={busy}
                renderError={reauthOnly}
                preview={() => Promise.resolve(llm.globalAvailable)}
                execute={() => clearChatbotLlm(guildId)}
                renderPlan={(sharedAvailable) => (
                  <Typography.Paragraph>
                    {sharedAvailable ? t('llm.useSharedPlan') : t('llm.useSharedPlanNone')}
                  </Typography.Paragraph>
                )}
                onDone={() => {
                  void message.success(t('llm.usingShared'));
                  router.refresh();
                }}
              />
            ) : null}
          </ActionRow>
        </Form.Item>
      </Form>
    </Card>
  );
}
