'use client';

import { useEffect, useId, useState } from 'react';
import { Alert, AutoComplete, Button, Form } from 'antd';
import { useTranslations } from 'next-intl';
import { LlmBaseUrlSchema, type LlmModelsRequest, type LlmModelsResult } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';

interface ModelFormValues {
  baseUrl: string;
  model: string;
  apiKey: string;
}

type FetchModels = (input: LlmModelsRequest) => Promise<LlmModelsResult>;

/** The ids found, and the address they were found at: a list for another address is not shown. */
interface FoundModels {
  baseUrl: string;
  ids: string[];
}

/**
 * The model input of an LLM form with a button that asks the endpoint which
 * models it serves. Must sit inside a form with `baseUrl`, `model` and `apiKey`
 * fields. The key typed is sent with the request and kept nowhere else.
 */
export function LlmModelField({ fetchModels }: { fetchModels: FetchModels }) {
  const t = useTranslations('web-settings');
  const form = Form.useFormInstance<ModelFormValues>();
  const baseUrl = Form.useWatch('baseUrl', form) as string | undefined;
  const apiKey = Form.useWatch('apiKey', form) as string | undefined;
  const [found, setFound] = useState<FoundModels | undefined>(undefined);
  const [reason, setReason] = useState<
    Extract<LlmModelsResult, { ok: false }>['reason'] | undefined
  >(undefined);
  const fetchList = useApiMutation(fetchModels);
  const inputId = useId();

  const address = (baseUrl ?? '').trim();
  const validAddress = LlmBaseUrlSchema.safeParse(address).success;
  const ids = found?.baseUrl === address ? found.ids : undefined;

  // A refusal belongs to the address and key it was given for; another one deserves a new try.
  useEffect(() => {
    setReason(undefined);
    fetchList.reset();
  }, [address, apiKey, fetchList.reset]);

  const onFetch = async () => {
    const values = await form.validateFields(['baseUrl', 'apiKey']).catch(() => undefined);
    if (values === undefined) return;
    const key = values.apiKey.trim();
    setReason(undefined);
    const outcome = await fetchList.run({
      baseUrl: values.baseUrl.trim(),
      ...(key === '' ? {} : { apiKey: key }),
    });
    if (outcome?.ok !== true) return;
    if (outcome.data.ok) setFound({ baseUrl: values.baseUrl.trim(), ids: outcome.data.models });
    else setReason(outcome.data.reason);
  };

  return (
    <>
      <Form.Item label={t('llm.form.model')} htmlFor={inputId} required>
        <ActionRow>
          <Form.Item
            name="model"
            noStyle
            rules={[{ required: true, whitespace: true, message: t('llm.form.modelRequired') }]}
          >
            <AutoComplete
              id={inputId}
              // Wraps under the button on a narrow screen instead of shrinking to a sliver.
              style={{ flex: '1 1 220px', minWidth: 0 }}
              options={ids?.map((id) => ({ value: id }))}
              showSearch={{
                filterOption: (input, option) =>
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
              }}
            />
          </Form.Item>
          <Button
            onClick={() => void onFetch()}
            loading={fetchList.pending}
            disabled={!validAddress}
          >
            {t('llm.form.fetchModels')}
          </Button>
        </ActionRow>
        {ids === undefined ? null : (
          <div style={{ marginTop: 'var(--space-1)' }}>
            {t('llm.form.modelsCount', { count: ids.length })}
          </div>
        )}
      </Form.Item>
      {reason === undefined ? null : (
        <Form.Item>
          <Alert type="error" showIcon title={t(`llm.form.testReasons.${reason}`)} />
        </Form.Item>
      )}
      {fetchList.error === undefined ? null : (
        <Form.Item>
          <ErrorAlert error={fetchList.error} />
        </Form.Item>
      )}
    </>
  );
}
