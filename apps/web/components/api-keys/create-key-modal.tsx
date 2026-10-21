'use client';

import { useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Radio } from 'antd';
import { useTranslations } from 'next-intl';
import {
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_READ_DEFAULT_DAYS,
  API_KEY_READ_MAX_DAYS,
  API_KEY_WRITE_DEFAULT_DAYS,
  API_KEY_WRITE_MAX_DAYS,
  ApiKeyMintSchema,
  type ApiKeyMintResult,
} from '@sab/shared';
import { ActionRow } from '@/components/ui/action-row';
import { ErrorAlert } from '@/components/data/error-alert';
import { useApiMutation } from '@/lib/api/mutations';
import { mintApiKey } from '@/lib/api-keys/api-keys-api';
import { useConfirmLeave, useUnsavedChanges } from '@/components/forms/unsaved-guard';

type Mode = 'READ' | 'WRITE';

interface FormValues {
  name: string;
  mode: Mode;
  expiresInDays: number;
}

const DEFAULT_DAYS: Record<Mode, number> = {
  READ: API_KEY_READ_DEFAULT_DAYS,
  WRITE: API_KEY_WRITE_DEFAULT_DAYS,
};
const MAX_DAYS: Record<Mode, number> = {
  READ: API_KEY_READ_MAX_DAYS,
  WRITE: API_KEY_WRITE_MAX_DAYS,
};

interface CreateKeyModalProps {
  open: boolean;
  onClose: () => void;
  onMinted: (key: ApiKeyMintResult) => void;
}

/** The form that mints a key. */
export function CreateKeyModal({ open, onClose, onMinted }: CreateKeyModalProps) {
  const t = useTranslations('web-api-keys');
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  // Tracked from the change event: `Form.useWatch` warns while the modal (and so the form) is unmounted.
  const [mode, setMode] = useState<Mode>('READ');
  const mint = useApiMutation(mintApiKey);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useConfirmLeave();
  useUnsavedChanges(open && dirty);

  const submit = async (values: FormValues) => {
    const parsed = ApiKeyMintSchema.safeParse(values);
    if (!parsed.success) {
      void message.error(t('form.invalid'));
      return;
    }
    const outcome = await mint.run(parsed.data);
    if (outcome?.ok !== true) return;
    form.resetFields();
    setMode('READ');
    setDirty(false);
    onMinted(outcome.data);
  };

  const discard = () => {
    mint.reset();
    form.resetFields();
    setMode('READ');
    setDirty(false);
    onClose();
  };

  // A typed name is lost on close, and a click beside the dialog is easy to make: ask first.
  const close = () => {
    if (mint.pending) return;
    confirmLeave(discard);
  };

  return (
    <Modal
      open={open}
      title={t('form.title')}
      onCancel={close}
      mask={{ closable: false }}
      destroyOnHidden
      footer={
        <ActionRow align="end">
          <Button onClick={close} disabled={mint.pending}>
            {t('form.cancel')}
          </Button>
          <Button type="primary" loading={mint.pending} onClick={() => form.submit()}>
            {t('form.submit')}
          </Button>
        </ActionRow>
      }
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ mode: 'READ', expiresInDays: DEFAULT_DAYS.READ }}
        onValuesChange={(changed: Partial<FormValues>) => {
          setDirty(true);
          if (changed.mode !== undefined) {
            setMode(changed.mode);
            form.setFieldValue('expiresInDays', DEFAULT_DAYS[changed.mode]);
          }
        }}
        onFinish={(values) => void submit(values)}
        disabled={mint.pending}
      >
        <Form.Item
          name="name"
          label={t('form.name')}
          rules={[
            { required: true, whitespace: true, message: t('form.nameRequired') },
            {
              max: API_KEY_NAME_MAX_LENGTH,
              message: t('form.nameTooLong', { max: API_KEY_NAME_MAX_LENGTH }),
            },
          ]}
        >
          <Input placeholder={t('form.namePlaceholder')} autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="mode"
          label={t('form.mode')}
          extra={
            mode === 'WRITE'
              ? t('form.modeWriteHelp', { max: API_KEY_WRITE_MAX_DAYS })
              : t('form.modeReadHelp')
          }
        >
          <Radio.Group
            options={[
              { value: 'READ', label: t('form.modeRead') },
              { value: 'WRITE', label: t('form.modeWrite') },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="expiresInDays"
          label={t('form.expiresInDays')}
          rules={[
            {
              required: true,
              type: 'number',
              min: 1,
              max: MAX_DAYS[mode],
              message: t('form.expiresRange', { max: MAX_DAYS[mode] }),
            },
          ]}
        >
          <InputNumber min={1} max={MAX_DAYS[mode]} precision={0} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
      {mint.error === undefined ? null : <ErrorAlert error={mint.error} />}
    </Modal>
  );
}
