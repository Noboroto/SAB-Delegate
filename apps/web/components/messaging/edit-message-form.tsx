'use client';

import { App, Alert, Form, Input } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MESSAGE_MAX_LENGTH, type EditBotMessageResult } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { useUnsavedChanges } from '@/components/forms/unsaved-guard';
import { editBotMessage } from '@/lib/messaging/messaging-api';
import { useFormValues } from '@/lib/messaging/use-form-values';
import { buildEdit, refProblem, requireBuilt } from '@/lib/messaging/requests';
import { MessagePreview } from './message-preview';
import { MessageRefItem } from './message-ref-item';

interface Values {
  message?: string;
  content?: string;
}

/** Replaces the text of a message the bot sent. The service says first whether the message can be edited. */
export function EditMessageForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-messaging');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<Values>();
  const values = useFormValues(form);
  useUnsavedChanges((values.content ?? '').trim() !== '');
  const request = buildEdit(values);

  return (
    <Form form={form} layout="vertical">
      <MessageRefItem
        name="message"
        label={t('edit.message')}
        problem={refProblem(values.message)}
      />
      <Form.Item name="content" label={t('edit.content')}>
        <Input.TextArea rows={5} maxLength={MESSAGE_MAX_LENGTH} showCount />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0 }}>
        <ConfirmAction
          danger={false}
          label={t('edit.action')}
          modalTitle={t('edit.modalTitle')}
          confirmLabel={t('edit.confirm')}
          disabled={!request.ok}
          canConfirm={(plan) => plan.status === 'EDITED'}
          preview={() => editBotMessage(guildId, requireBuilt(request), true)}
          execute={() => editBotMessage(guildId, requireBuilt(request), false)}
          renderPlan={(plan: EditBotMessageResult) =>
            plan.status === 'EDITED' ? (
              plan.content === null ? null : (
                <MessagePreview content={plan.content} />
              )
            ) : (
              <Alert
                type="warning"
                showIcon
                title={
                  plan.status === 'NOT_BOT_MESSAGE'
                    ? t('edit.notBotMessage')
                    : t('edit.nothingToCopy')
                }
              />
            )
          }
          onDone={() => {
            void message.success(t('edit.done'));
            form.resetFields();
            router.refresh();
          }}
        />
      </Form.Item>
    </Form>
  );
}
