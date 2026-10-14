'use client';

import { Form, Input } from 'antd';
import { useTranslations } from 'next-intl';
import { REACTION_EMOJI_MAX_LENGTH } from '@sab/shared';
import { readMessageRef } from '@/lib/tools/build-request';

interface FieldProps {
  name: string;
  label: string;
  extra?: string;
}

/** A pasted "Copy Message Link"; the channel is read out of the link. */
export function MessageRefItem({ name, label, extra }: FieldProps) {
  const t = useTranslations('web-tools');

  return (
    <Form.Item
      name={name}
      label={label}
      extra={extra}
      validateTrigger="onBlur"
      rules={[
        { required: true, whitespace: true, message: t('common.required') },
        {
          validator: (_rule, value: string | undefined) =>
            value === undefined || value.trim() === '' || readMessageRef(value) !== undefined
              ? Promise.resolve()
              : Promise.reject(new Error(t('common.messageRefInvalid'))),
        },
      ]}
    >
      <Input placeholder={t('common.messageRefPlaceholder')} allowClear />
    </Form.Item>
  );
}

/** The emoji a message was reacted with, as typed or pasted. */
export function EmojiItem({ name, label }: Omit<FieldProps, 'extra'>) {
  const t = useTranslations('web-tools');

  return (
    <Form.Item
      name={name}
      label={label}
      rules={[{ required: true, whitespace: true, message: t('common.required') }]}
    >
      <Input maxLength={REACTION_EMOJI_MAX_LENGTH} placeholder={t('common.emojiPlaceholder')} />
    </Form.Item>
  );
}

/** A required value picked from a list (channel, role): the rule is only the "choose one" message. */
export function useRequiredRule() {
  const t = useTranslations('web-tools');
  return { required: true, message: t('common.required') };
}
