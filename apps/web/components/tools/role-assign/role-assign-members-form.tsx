'use client';

import { Form, Input, Segmented } from 'antd';
import { useTranslations } from 'next-intl';
import {
  parseSnowflakes,
  ROLE_ASSIGN_MAX_USER_IDS,
  RoleAssignMembersRequestSchema,
} from '@sab/shared';
import { RoleSelect } from '@/components/forms/role-select';
import { buildRequest } from '@/lib/tools/build-request';
import { useUnsavedText } from '@/lib/tools/use-unsaved-text';
import { useRequiredRule } from '../shared/fields';
import { ToolCard } from '../shared/tool-card';
import { RoleAssignRunner } from './role-assign-runner';

interface Values {
  roleId?: string;
  userIds?: string;
  membersOfRoleId?: string;
  mode?: 'give' | 'take';
}

/** Gives or takes one role for a list of members and/or everyone who holds another role. */
export function RoleAssignMembersForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const values: Values = Form.useWatch([], form) ?? {};
  const remove = values.mode === 'take';
  const ids = parseSnowflakes(values.userIds ?? '');
  const markSent = useUnsavedText(values.userIds);

  return (
    <ToolCard
      title={t('roleAssign.members.title')}
      description={t('roleAssign.members.description')}
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
        <Form.Item
          name="userIds"
          label={t('roleAssign.userIdsLabel')}
          dependencies={['membersOfRoleId']}
          rules={[
            {
              validator: () => {
                if (ids.length > ROLE_ASSIGN_MAX_USER_IDS) {
                  return Promise.reject(
                    new Error(
                      t('roleAssign.tooManyIds', {
                        count: ids.length,
                        max: ROLE_ASSIGN_MAX_USER_IDS,
                      }),
                    ),
                  );
                }
                return ids.length > 0 || values.membersOfRoleId !== undefined
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('roleAssign.membersRequired')));
              },
            },
          ]}
          extra={t('roleAssign.userIdsHelp', { count: ids.length, max: ROLE_ASSIGN_MAX_USER_IDS })}
        >
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
        </Form.Item>
        <Form.Item
          name="membersOfRoleId"
          label={t('roleAssign.membersOfRoleLabel')}
          extra={t('roleAssign.membersOfRoleHelp')}
        >
          <RoleSelect guildId={guildId} allowClear />
        </Form.Item>
      </Form>
      <RoleAssignRunner
        guildId={guildId}
        form={form}
        onDone={() => markSent(values.userIds)}
        path="role-assign/members"
        remove={remove}
        build={(flags) =>
          buildRequest(RoleAssignMembersRequestSchema, {
            roleId: values.roleId,
            userIds: ids,
            membersOfRoleId: values.membersOfRoleId,
            remove,
            ...flags,
          })
        }
      />
    </ToolCard>
  );
}
