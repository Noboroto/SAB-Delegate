'use client';

import { useTransition, type ReactNode } from 'react';
import { Alert, Col, Row, Spin, Tabs } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type {
  ChatbotConfig,
  ChatbotQuotaListQuery,
  ChatbotQuotaPage,
  ChatbotTurnListQuery,
  ChatbotTurnPage,
} from '@sab/shared';
import { useConfirmLeave } from '@/components/forms/unsaved-guard';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { CHATBOT_TABS, type ChatbotTab } from '@/lib/chatbot/tabs';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';
import { formatDateTime } from '@/lib/format-datetime';
import { ChatbotChannelsCard } from './chatbot-channels-card';
import { ChatbotHistoryTable } from './chatbot-history-table';
import { ChatbotLlmCard } from './chatbot-llm-card';
import { ChatbotMemoryCard } from './chatbot-memory-card';
import { ChatbotQuotaTable } from './chatbot-quota-table';
import { ChatbotSettingsCard } from './chatbot-settings-card';

type ChatbotViewProps = {
  guildId: string;
  config: ChatbotConfig;
} &
  /** `adminServer`: whether this is the bot's admin server, the only one that has the shared model's settings page. */
  (
    | { tab: 'settings'; adminServer: boolean }
    | { tab: 'usage'; quota: ChatbotQuotaPage; query: ChatbotQuotaListQuery }
    | { tab: 'history'; turns: ChatbotTurnPage; query: ChatbotTurnListQuery }
  );

/** The chatbot of one server; the tab is in the URL so a link opens it and the server reads only that tab's list. */
export function ChatbotView(props: ChatbotViewProps) {
  const { guildId, config } = props;
  const t = useTranslations('web-chatbot');
  const locale = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [switching, startSwitch] = useTransition();
  const confirmLeave = useConfirmLeave();
  const { llm } = config;

  const panel: ReactNode =
    props.tab === 'usage' ? (
      <ChatbotQuotaTable guildId={guildId} page={props.quota} query={props.query} />
    ) : props.tab === 'history' ? (
      <ChatbotHistoryTable guildId={guildId} page={props.turns} query={props.query} />
    ) : (
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <FormColumn>
            <ChatbotSettingsCard guildId={guildId} config={config} />
            <ChatbotChannelsCard guildId={guildId} channels={config.channels} />
            <ChatbotMemoryCard guildId={guildId} />
          </FormColumn>
        </Col>
        <Col xs={24} xl={12}>
          {/* Remounted when the stored values change, so the form starts from what the server now holds. */}
          <FormColumn>
            <ChatbotLlmCard
              key={`${llm.source}:${llm.baseUrl ?? ''}:${llm.model ?? ''}:${llm.keyLast4 ?? ''}`}
              guildId={guildId}
              llm={llm}
              adminServer={props.adminServer}
            />
          </FormColumn>
        </Col>
      </Row>
    );

  const open = (key: string) => {
    const next = CHATBOT_TABS.find((tab): tab is ChatbotTab => tab === key);
    if (next === undefined || next === props.tab) return;
    // The LLM form is on the settings tab: leaving it with typed values asks first.
    confirmLeave(() => startSwitch(() => router.push(`${pathname}?tab=${next}`)));
  };

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      {llm.pausedUntil === undefined ? null : (
        <Alert
          type="warning"
          showIcon
          title={t('paused', { time: formatDateTime(llm.pausedUntil, locale) })}
          style={{ marginBottom: 'var(--space-4)' }}
        />
      )}
      <Tabs
        activeKey={props.tab}
        onChange={open}
        items={CHATBOT_TABS.map((tab) => ({
          key: tab,
          label: t(`tabs.${tab}`),
          children: tab === props.tab ? <Spin spinning={switching}>{panel}</Spin> : null,
        }))}
      />
    </>
  );
}
