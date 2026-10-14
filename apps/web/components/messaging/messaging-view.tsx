'use client';

import { useState } from 'react';
import { Tabs } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { MESSAGING_TABS, type MessagingTab } from '@/lib/messaging/tabs';
import { CopyMessageForm } from './copy-message-form';
import { EditMessageForm } from './edit-message-form';
import { PollForm } from './poll-form';
import { ReactForm } from './react-form';
import { SendMessageForm } from './send-message-form';

/** The things the bot can post or change in a channel; the tab is in the URL so a link opens the right form. */
export function MessagingView({
  guildId,
  initialTab,
}: {
  guildId: string;
  initialTab: MessagingTab;
}) {
  const t = useTranslations('web-messaging');
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState<MessagingTab>(initialTab);

  const forms: Record<MessagingTab, React.ReactNode> = {
    send: <SendMessageForm guildId={guildId} />,
    copy: <CopyMessageForm guildId={guildId} />,
    react: <ReactForm guildId={guildId} />,
    poll: <PollForm guildId={guildId} />,
    edit: <EditMessageForm guildId={guildId} />,
  };

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <Tabs
        activeKey={active}
        onChange={(key) => {
          const next = MESSAGING_TABS.find((tab) => tab === key);
          if (next === undefined) return;
          setActive(next);
          router.replace(`${pathname}?tab=${next}`, { scroll: false });
        }}
        items={MESSAGING_TABS.map((tab) => ({
          key: tab,
          label: t(`tabs.${tab}`),
          children: <div style={{ maxWidth: 720 }}>{forms[tab]}</div>,
        }))}
      />
    </>
  );
}
