'use client';

import { Button, Form, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { RoleMembersQuerySchema, RoleMembersResultSchema } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { RoleSelect } from '@/components/forms/role-select';
import { buildRequest } from '@/lib/tools/build-request';
import { getTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { IdList } from '../shared/id-list';
import { ToolCard } from '../shared/tool-card';

interface Values {
  roleId: string;
  channelId?: string;
}

/** The ids of the members of a role, optionally only those who can see one channel. */
export function RoleMembersForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const action = useToolRun((query: { roleId: string; channelId?: string }) =>
    getTool(guildId, 'info/role-members', query, RoleMembersResultSchema),
  );

  return (
    <ToolCard title={t('info.roleMembers.title')} description={t('info.roleMembers.description')}>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => void action.submit(buildRequest(RoleMembersQuerySchema, values))}
      >
        <Form.Item name="roleId" label={t('info.roleLabel')} rules={[required]}>
          <RoleSelect guildId={guildId} />
        </Form.Item>
        <Form.Item
          name="channelId"
          label={t('info.roleMembers.channelLabel')}
          extra={t('info.roleMembers.channelHelp')}
        >
          <ChannelSelect guildId={guildId} allowClear />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={action.pending}>
          {t('info.roleMembers.submit')}
        </Button>
      </Form>
      {action.error === undefined ? null : (
        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={action.error} />
        </div>
      )}
      {action.result === undefined ? null : (
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <Typography.Text>
            {t('info.roleMembers.roleName', { name: action.result.roleName })}
          </Typography.Text>
          <IdList title={t('info.roleMembers.listTitle')} ids={action.result.userIds} />
        </div>
      )}
    </ToolCard>
  );
}
