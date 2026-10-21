'use client';

import { useTransition, type ReactNode } from 'react';
import { Alert, Spin, Tabs } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type {
  AccessRulesView,
  EmailBlocklist,
  EmailListSummary,
  EmailMemberListQuery,
  EmailMemberPage,
  EmailVerifyConfig,
  EmailVerifyStatus,
  SmtpSettings,
} from '@sab/shared';
import { useConfirmLeave } from '@/components/forms/unsaved-guard';
import { Heading } from '@/components/ui/heading';
import { FormColumn } from '@/components/ui/form-column';
import { EMAIL_VERIFY_TABS, type EmailVerifyTab } from '@/lib/email-verify/tabs';
import { ButtonCard } from './button-card';
import { ListsCard } from './lists-card';
import { MembersCard } from './members-card';
import { OverviewCard } from './overview-card';
import { RulesEditor } from './rules-editor';
import { SettingsCard } from './settings-card';
import { SmtpCard } from './smtp-card';

/** What each tab needs from the server; the page reads only the open tab's data. */
export type EmailVerifyTabProps =
  | { tab: 'overview'; status: EmailVerifyStatus }
  | { tab: 'settings'; config: EmailVerifyConfig }
  | {
      tab: 'rules';
      rules: AccessRulesView;
      lists: EmailListSummary[];
      blocklist: EmailBlocklist;
      config: EmailVerifyConfig;
    }
  | { tab: 'lists'; lists: EmailListSummary[] }
  | { tab: 'members'; members: EmailMemberPage; query: EmailMemberListQuery }
  | { tab: 'smtp' };

type EmailVerifyViewProps = {
  guildId: string;
  /** The mail server's page exists in the admin server only; the settings read says which one this is. */
  smtp: SmtpSettings;
} & EmailVerifyTabProps;

/** A server's email verification; the tab is in the URL so a link opens it and the server reads only that tab's data. */
export function EmailVerifyView(props: EmailVerifyViewProps) {
  const { guildId, smtp } = props;
  const confirmLeave = useConfirmLeave();
  const t = useTranslations('web-email-verify');
  const router = useRouter();
  const pathname = usePathname();
  const [switching, startSwitch] = useTransition();

  const tabs = EMAIL_VERIFY_TABS.filter((tab) => tab !== 'smtp' || smtp.adminServer);

  const panel = ((): ReactNode => {
    switch (props.tab) {
      case 'overview':
        return (
          <FormColumn>
            <OverviewCard guildId={guildId} status={props.status} />
          </FormColumn>
        );
      case 'settings':
        return (
          <FormColumn>
            <SettingsCard guildId={guildId} config={props.config} />
            <ButtonCard guildId={guildId} verifyMessage={props.config.verifyMessage} />
          </FormColumn>
        );
      case 'rules':
        return (
          // Remounted when the saved rules change, so the editor starts from what the server now holds.
          <RulesEditor
            key={JSON.stringify(props.rules)}
            guildId={guildId}
            view={props.rules}
            lists={props.lists}
            blocklist={props.blocklist}
            config={props.config}
          />
        );
      case 'lists':
        return <ListsCard guildId={guildId} lists={props.lists} />;
      case 'members':
        return <MembersCard guildId={guildId} page={props.members} query={props.query} />;
      case 'smtp':
        return (
          <FormColumn>
            <SmtpCard guildId={guildId} settings={smtp} />
          </FormColumn>
        );
    }
  })();

  const open = (key: string) => {
    const next = tabs.find((tab): tab is EmailVerifyTab => tab === key);
    if (next === undefined || next === props.tab) return;
    confirmLeave(() => startSwitch(() => router.push(`${pathname}?tab=${next}`)));
  };

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      {smtp.available ? null : (
        <Alert
          type="warning"
          showIcon
          title={t('unavailable')}
          style={{ marginBottom: 'var(--space-4)' }}
        />
      )}
      <Tabs
        activeKey={props.tab}
        onChange={open}
        items={tabs.map((tab) => ({
          key: tab,
          label: t(`tabs.${tab}`),
          children: tab === props.tab ? <Spin spinning={switching}>{panel}</Spin> : null,
        }))}
      />
    </>
  );
}
