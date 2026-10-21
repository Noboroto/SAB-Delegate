'use client';

import { Button, Form, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { AttendanceCheckSchema, AttendanceResultSchema, type AttendanceMember } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ResultBlock } from '@/components/ui/result-block';
import { ChannelSelect } from '@/components/forms/channel-select';
import { RoleSelect } from '@/components/forms/role-select';
import { CHANNEL_TYPE } from '@/lib/discord/use-channels';
import { buildRequest } from '@/lib/tools/build-request';
import { getTool } from '@/lib/tools/tool-api';
import { useToolRun } from '@/lib/tools/use-tool-run';
import { useRequiredRule } from '../shared/fields';
import { TextBlock } from '../shared/text-block';
import { ToolCard } from '../shared/tool-card';

interface Values {
  roleId: string;
  voiceChannelId: string;
}

function MemberLines({ title, members }: { title: string; members: readonly AttendanceMember[] }) {
  const t = useTranslations('web-tools');

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <Typography.Text strong>
        {t('attendance.listTitle', { title, count: members.length })}
      </Typography.Text>
      {members.length === 0 ? (
        <Typography.Text type="secondary">{t('common.none')}</Typography.Text>
      ) : (
        <TextBlock
          text={members.map((member) => `${member.username} (${member.userId})`).join('\n')}
          copyText={members.map((member) => member.userId).join('\n')}
          copyLabel={t('attendance.copyIds', { title })}
        />
      )}
    </div>
  );
}

/** Who of a role is in a voice channel right now, and who is not. */
export function AttendanceForm({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');
  const required = useRequiredRule();
  const [form] = Form.useForm<Values>();
  const action = useToolRun((query: { roleId: string; voiceChannelId: string }) =>
    getTool(guildId, 'attendance', query, AttendanceResultSchema),
  );

  const onFinish = (values: Values) => {
    const query = buildRequest(AttendanceCheckSchema, values);
    return action.submit(query);
  };

  return (
    <ToolCard>
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => void onFinish(values)}
        onValuesChange={action.clear}
      >
        <Form.Item name="roleId" label={t('attendance.roleLabel')} rules={[required]}>
          <RoleSelect guildId={guildId} />
        </Form.Item>
        <Form.Item name="voiceChannelId" label={t('attendance.channelLabel')} rules={[required]}>
          <ChannelSelect guildId={guildId} types={[CHANNEL_TYPE.voice, CHANNEL_TYPE.stage]} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={action.pending}>
            {t('attendance.submit')}
          </Button>
        </Form.Item>
      </Form>
      {action.error === undefined ? null : (
        <ResultBlock>
          <ErrorAlert
            error={action.error}
            onRetry={() => void action.retry()}
            retrying={action.pending}
          />
        </ResultBlock>
      )}
      {action.result === undefined ? null : (
        <ResultBlock>
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <Typography.Text>
              {t('attendance.summary', {
                role: action.result.roleName,
                present: action.result.present.length,
                total: action.result.total,
              })}
            </Typography.Text>
            <MemberLines title={t('attendance.present')} members={action.result.present} />
            <MemberLines title={t('attendance.absent')} members={action.result.absent} />
          </div>
        </ResultBlock>
      )}
    </ToolCard>
  );
}
