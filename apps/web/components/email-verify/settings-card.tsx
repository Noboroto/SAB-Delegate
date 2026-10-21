'use client';

import { App, Button, Card, Form, Input, Switch } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EMAIL_VERIFY_MESSAGE_MAX, ROLES_MAX, type EmailVerifyConfig } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ChannelSelect } from '@/components/forms/channel-select';
import { RoleSelect } from '@/components/forms/role-select';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { configureEmailVerify } from '@/lib/email-verify/email-verify-api';
import {
  settingsFromConfig,
  settingsPatch,
  type SettingsValues,
} from '@/lib/email-verify/settings-patch';
import { useUnsavedChanges } from '@/components/forms/unsaved-guard';

/** The switch, the roles, the log channel and the join behaviour of a server's email verification. */
export function SettingsCard({ guildId, config }: { guildId: string; config: EmailVerifyConfig }) {
  const t = useTranslations('web-email-verify.settings');
  const tRules = useTranslations('web-email-verify.rules');
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<SettingsValues>();
  const save = useApiMutation((values: SettingsValues) =>
    configureEmailVerify(guildId, settingsPatch(values, config)),
  );
  const watched = Form.useWatch([], form);
  const dirty =
    Object.keys(settingsPatch(watched ?? settingsFromConfig(config), config)).length > 0;
  useUnsavedChanges(dirty);

  const onFinish = async (values: SettingsValues) => {
    const outcome = await save.run(values);
    if (outcome?.ok !== true) return;
    void message.success(t('saved'));
    router.refresh();
  };

  return (
    <Card title={t('title')}>
      <Form<SettingsValues>
        form={form}
        layout="vertical"
        disabled={save.pending}
        initialValues={settingsFromConfig(config)}
        onValuesChange={() => save.reset()}
        onFinish={(values) => void onFinish(values)}
      >
        <Form.Item name="enabled" label={t('enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="defaultRoleIds"
          label={t('defaultRoles')}
          extra={t('defaultRolesHelp', { max: ROLES_MAX })}
          rules={[
            { type: 'array', max: ROLES_MAX, message: tRules('rolesTooMany', { max: ROLES_MAX }) },
          ]}
        >
          <RoleSelect guildId={guildId} multiple maxCount={ROLES_MAX} hideManaged allowClear />
        </Form.Item>
        <Form.Item
          name="unverifiedRoleId"
          label={t('unverifiedRole')}
          extra={t('unverifiedRoleHelp')}
        >
          <RoleSelect guildId={guildId} hideManaged allowClear />
        </Form.Item>
        <Form.Item name="logChannelId" label={t('logChannel')} extra={t('logChannelHelp')}>
          <ChannelSelect guildId={guildId} types={TEXT_CHANNEL_TYPES} allowClear />
        </Form.Item>
        <Form.Item
          name="verifyMessage"
          label={t('verifyMessage')}
          extra={t('verifyMessageHelp', { max: EMAIL_VERIFY_MESSAGE_MAX })}
        >
          <Input.TextArea
            maxLength={EMAIL_VERIFY_MESSAGE_MAX}
            autoSize={{ minRows: 3, maxRows: 8 }}
            showCount
          />
        </Form.Item>
        <Form.Item
          name="autoVerifyOnJoin"
          label={t('autoVerifyOnJoin')}
          extra={t('autoVerifyOnJoinHelp')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="autoUnverifiedOnJoin"
          label={t('autoUnverifiedOnJoin')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        {save.error === undefined ? null : (
          <Form.Item>
            <ErrorAlert error={save.error} />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <ActionRow>
            <Button type="primary" htmlType="submit" loading={save.pending} disabled={!dirty}>
              {t('save')}
            </Button>
          </ActionRow>
        </Form.Item>
      </Form>
    </Card>
  );
}
