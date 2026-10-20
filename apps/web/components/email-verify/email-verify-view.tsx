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
import { Heading } from '@/components/ui/heading';
import { EMAIL_VERIFY_TABS, type EmailVerifyTab } from '@/lib/email-verify/tabs';
import { BlocklistCard } from './blocklist-card';
import { ButtonCard } from './button-card';
import { ListsCard } from './lists-card';
import { MembersCard } from './members-card';
import { OverviewCard } from './overview-card';
import { RulesEditor } from './rules-editor';
import { SettingsCard } from './settings-card';
import { SmtpCard } from './smtp-card';
import { UnsavedGuardProvider, useConfirmLeave } from './unsaved-guard';

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
  | { tab: 'blocklist'; blocklist: EmailBlocklist }
  | { tab: 'lists'; lists: EmailListSummary[] }
  | { tab: 'members'; members: EmailMemberPage; query: EmailMemberListQuery }
  | { tab: 'button'; config: EmailVerifyConfig }
  | { tab: 'smtp' };

type EmailVerifyViewProps = {
  guildId: string;
  /** The mail server's page exists in the admin server only; the settings read says which one this is. */
  smtp: SmtpSettings;
} & EmailVerifyTabProps;

/** A server's email verification; the tab is in the URL so a link opens it and the server reads only that tab's data. */
export function EmailVerifyView(props: EmailVerifyViewProps) {
  return (
    <UnsavedGuardProvider>
      <EmailVerifyTabs {...props} />
    </UnsavedGuardProvider>
  );
}

function EmailVerifyTabs(props: EmailVerifyViewProps) {
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
        return <OverviewCard guildId={guildId} status={props.status} />;
      case 'settings':
        return <SettingsCard guildId={guildId} config={props.config} />;
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
      case 'blocklist':
        return (
          <BlocklistCard
            key={props.blocklist.patterns.join('\n')}
            guildId={guildId}
            blocklist={props.blocklist}
          />
        );
      case 'lists':
        return <ListsCard guildId={guildId} lists={props.lists} />;
      case 'members':
        return <MembersCard guildId={guildId} page={props.members} query={props.query} />;
      case 'button':
        return <ButtonCard guildId={guildId} verifyMessage={props.config.verifyMessage} />;
      case 'smtp':
        return <SmtpCard guildId={guildId} settings={smtp} />;
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
