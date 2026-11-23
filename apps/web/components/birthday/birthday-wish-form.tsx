'use client';

import { useRef } from 'react';
import { App, Button, Form, Input, Typography, theme } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BIRTHDAY_NAME_PLACEHOLDER,
  BIRTHDAY_WISH_MAX_LENGTH,
  BIRTHDAY_WISH_MAX_NAMES,
  BirthdayWishInputSchema,
  countNamePlaceholders,
  renderBirthdayWish,
  type BirthdayWishView,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { useConfirmLeave, useUnsavedChanges } from '@/components/forms/unsaved-guard';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { addBirthdayWish, updateBirthdayWish } from '@/lib/birthday/birthday-wish-api';

interface FormValues {
  text?: string;
}

interface BirthdayWishFormProps {
  guildId: string;
  /** The wish being edited; `undefined` adds a new one. */
  editing: BirthdayWishView | undefined;
  onSaved: () => void;
  /** Closes the form without a save. */
  onClose: () => void;
}

export function BirthdayWishForm({ guildId, editing, onSaved, onClose }: BirthdayWishFormProps) {
  const t = useTranslations('web-birthday.wishes');
  const tCommon = useTranslations('web-common');
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();
  const [form] = Form.useForm<FormValues>();
  const confirmLeave = useConfirmLeave();
  const textArea = useRef<HTMLTextAreaElement | null>(null);
  const watched = Form.useWatch('text', form);
  const text = watched ?? '';
  useUnsavedChanges(text !== (editing?.text ?? ''));
  const save = useApiMutation((wish: Parameters<typeof addBirthdayWish>[1]) =>
    editing === undefined
      ? addBirthdayWish(guildId, wish)
      : updateBirthdayWish(guildId, editing.id, wish),
  );

  const placeholder = BIRTHDAY_NAME_PLACEHOLDER;

  /** The sentence for what is wrong with the text, or `undefined` when the server would accept it. */
  const problemWith = (value: string): string | undefined => {
    const parsed = BirthdayWishInputSchema.safeParse({ text: value });
    if (parsed.success) return undefined;
    const code = parsed.error.issues[0]?.code;
    if (code === 'too_small') return t('validation.required');
    if (code === 'too_big') return t('validation.tooLong', { max: BIRTHDAY_WISH_MAX_LENGTH });
    if (value.includes('\u0000')) return t('validation.invalidCharacter');
    return countNamePlaceholders(value) === 0
      ? t('validation.missingName', { placeholder })
      : t('validation.tooManyNames', { placeholder, max: BIRTHDAY_WISH_MAX_NAMES });
  };

  const fits = text.length + placeholder.length <= BIRTHDAY_WISH_MAX_LENGTH;

  const insertPlaceholder = () => {
    const current = text;
    const element = textArea.current;
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${placeholder}${current.slice(end)}`;
    if (next.length > BIRTHDAY_WISH_MAX_LENGTH) return;
    form.setFieldValue('text', next);
    const caret = start + placeholder.length;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  };

  const submit = async (values: FormValues) => {
    const parsed = BirthdayWishInputSchema.safeParse({ text: values.text ?? '' });
    if (!parsed.success) {
      form.setFields([{ name: 'text', errors: [problemWith(values.text ?? '') ?? ''] }]);
      return;
    }
    const outcome = await save.run(parsed.data);
    if (outcome === undefined) return;
    if (!outcome.ok) {
      // No readable answer: the wish may have been saved. Gone: someone else removed it.
      // Either way the list behind the form is re-read.
      if (outcome.error.status === 0 || outcome.error.code === 'BIRTHDAY_WISH_NOT_FOUND') {
        router.refresh();
      }
      // Saving a new wish again could add it twice, so the form closes and points at the list.
      if (outcome.error.status === 0 && editing === undefined) {
        void message.warning(t('form.unknownOutcome'));
        onClose();
      }
      return;
    }
    void message.success(t('form.saved'));
    router.refresh();
    onSaved();
  };

  return (
    <Form<FormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={{ text: editing?.text }}
      onFinish={(values) => void submit(values)}
      disabled={save.pending}
    >
      <Form.Item
        name="text"
        label={t('form.text')}
        extra={t('form.textHelp', { placeholder })}
        rules={[
          {
            validator: (_, value: string | undefined) => {
              const problem = problemWith(value ?? '');
              return problem === undefined ? Promise.resolve() : Promise.reject(new Error(problem));
            },
          },
        ]}
      >
        <Input.TextArea
          ref={(instance) => {
            const element: unknown = instance?.resizableTextArea?.textArea;
            textArea.current = element instanceof HTMLTextAreaElement ? element : null;
          }}
          maxLength={BIRTHDAY_WISH_MAX_LENGTH}
          showCount
          autoSize={{ minRows: 5, maxRows: 14 }}
        />
      </Form.Item>
      <Form.Item>
        <Button onClick={insertPlaceholder} disabled={!fits || save.pending}>
          {t('form.insert', { placeholder })}
        </Button>
      </Form.Item>
      <Form.Item label={t('form.preview')}>
        <div
          aria-label={t('form.preview')}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: token.borderRadius,
            background: token.colorFillQuaternary,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {text.trim() === '' ? (
            <Typography.Text type="secondary">{t('form.previewEmpty')}</Typography.Text>
          ) : (
            renderBirthdayWish(text, t('form.previewName'))
          )}
        </div>
      </Form.Item>
      {save.error === undefined ? null : (
        <Form.Item>
          <ErrorAlert error={save.error} />
        </Form.Item>
      )}
      <ActionRow align="end">
        <Button onClick={() => confirmLeave(onClose)} disabled={save.pending}>
          {tCommon('cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={save.pending}>
          {t('form.save')}
        </Button>
      </ActionRow>
    </Form>
  );
}
