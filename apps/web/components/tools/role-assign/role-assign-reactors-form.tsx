'use client';

import { Form, Segmented } from 'antd';
import { useTranslations } from 'next-intl';
import { RoleAssignReactorsRequestSchema } from '@sab/shared';
import { RoleSelect } from '@/components/forms/role-select';
import { buildRequest, readMessageRef } from '@/lib/tools/build-request';
import { EmojiItem, MessageRefItem, useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { RoleAssignRunner } from './role-assign-runner';

interface Values {
  roleId?: string;
  message?: string;
  emoji?: string;
  mode?: 'give' | 'take';
}

/** Gives or takes one role for everyone who reacted to a message with one emoji. */
export function RoleAssignReactorsForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const remove = values.mode === 'take';

  return (
    <ToolCard
      title={t('roleAssign.reactors.title')}
      description={t('roleAssign.reactors.description')}
    >
      <Form form={form} layout="vertical" initialValues={{ mode: 'give' }}>
        <Form.Item name="mode" label={t('roleAssign.modeLabel')}>
          <Segmented
            options={[
              { value: 'give', label: t('roleAssign.modeGive') },
              { value: 'take', label: t('roleAssign.modeTake') },
            ]}
          />
        </Form.Item>
        <Form.Item name="roleId" label={t('roleAssign.roleLabel')} rules={[required]}>
          <RoleSelect guildId={guildId} hideManaged />
        </Form.Item>
        <MessageRefItem name="message" label={t('roleAssign.messageLabel')} />
        <EmojiItem name="emoji" label={t('roleAssign.emojiLabel')} />
      </Form>
      <RoleAssignRunner
        guildId={guildId}
        path="role-assign/reactors"
        remove={remove}
        build={(flags) => {
          const ref = readMessageRef(values.message);
          return ref === undefined
            ? undefined
            : buildRequest(RoleAssignReactorsRequestSchema, {
                roleId: values.roleId,
                ...ref,
                emoji: values.emoji,
                remove,
                ...flags,
              });
        }}
      />
    </ToolCard>
  );
}
