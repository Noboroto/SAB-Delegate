'use client';

import type { ReactNode } from 'react';
import { Tabs } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirmLeave } from '@/components/forms/unsaved-guard';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { THREADS_TABS, type ThreadsTab } from '@/lib/tools/threads-tabs';
import { useUrlTab } from '@/lib/use-url-tab';
import { CreateThreadForm } from './create-thread-form';
import { DeleteThreadsForm } from './delete-threads-form';
import { PrivateReactorsThreadsForm } from './private-reactors-threads-form';
import { PrivateThreadsForm } from './private-threads-form';
import { RenameThreadsForm } from './rename-threads-form';

/**
 * Threads: open one, open private ones for members, and rename or delete many
 * by prefix. One action per tab, and the tab is in the address so a link opens
 * the right form.
 */
export function ThreadsTool({
  guildId,
  initialTab = 'create',
}: {
  guildId: string;
  initialTab?: ThreadsTab;
}) {
  const t = useTranslations('web-tools');
  const router = useRouter();
  const pathname = usePathname();
  const confirmLeave = useConfirmLeave();
  const active = useUrlTab(THREADS_TABS, initialTab);

  const forms: Record<ThreadsTab, ReactNode> = {
    create: <CreateThreadForm guildId={guildId} />,
    private: <PrivateThreadsForm guildId={guildId} />,
    reactors: <PrivateReactorsThreadsForm guildId={guildId} />,
    rename: <RenameThreadsForm guildId={guildId} />,
    delete: <DeleteThreadsForm guildId={guildId} />,
  };

  return (
    <>
      <Heading title={t('tools.threads.name')} subtitle={t('tools.threads.description')} />
      <Tabs
        activeKey={active}
        // A tab that is left is unmounted, so text typed in it is gone: ask first.
        destroyOnHidden
        onChange={(key) => {
          const next = THREADS_TABS.find((tab) => tab === key);
          if (next === undefined || next === active) return;
          confirmLeave(() => router.replace(`${pathname}?tab=${next}`, { scroll: false }));
        }}
        items={THREADS_TABS.map((tab) => ({
          key: tab,
          label: t(`threads.tabs.${tab}`),
          children: <FormColumn>{forms[tab]}</FormColumn>,
        }))}
      />
    </>
  );
}
