'use client';

import { useTransition } from 'react';
import { Col, Row, Select, Spin, Tabs } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { BirthdayEntryView, BirthdayWishView } from '@sab/shared';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { useConfirmLeave } from '@/components/forms/unsaved-guard';
import { PageState } from '@/components/ui/page-state';
import { BIRTHDAY_TABS, type BirthdayTab } from '@/lib/birthday/tabs';
import { BirthdayAddForm, BIRTHDAY_ADD_FIRST_FIELD_ID } from './birthday-add-form';
import { BirthdayImport } from './birthday-import';
import { BirthdayTable } from './birthday-table';
import { BirthdayWishes } from './birthday-wishes';

/** The tab lives in the URL (`?tab=`); the page reads only the data of the open one. */
type BirthdayPageProps = { guildId: string } & (
  | {
      tab: 'list';
      entries: readonly BirthdayEntryView[];
      /** The month the server filtered by; `undefined` is every month. */
      month: number | undefined;
    }
  | { tab: 'wishes'; wishes: readonly BirthdayWishView[] }
);

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

export function BirthdayPage(props: BirthdayPageProps) {
  const { guildId } = props;
  const t = useTranslations('web-birthday');
  const router = useRouter();
  const pathname = usePathname();
  const confirmLeave = useConfirmLeave();
  const [pending, startTransition] = useTransition();
  const [switching, startSwitch] = useTransition();

  // The month lives in the URL so the server does the filtering and a reload keeps it.
  const chooseMonth = (next: number | undefined) =>
    startTransition(() => router.push(next === undefined ? pathname : `${pathname}?month=${next}`));

  const open = (key: string) => {
    const next = BIRTHDAY_TABS.find((tab): tab is BirthdayTab => tab === key);
    if (next === undefined || next === props.tab) return;
    // The add form on the list tab may hold typed values: leaving asks first.
    confirmLeave(() =>
      startSwitch(() => router.push(next === 'list' ? pathname : `${pathname}?tab=${next}`)),
    );
  };

  const panel =
    props.tab === 'wishes' ? (
      <BirthdayWishes guildId={guildId} wishes={props.wishes} />
    ) : (
      <ListPanel
        guildId={guildId}
        entries={props.entries}
        month={props.month}
        pending={pending}
        chooseMonth={chooseMonth}
      />
    );

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <Tabs
        activeKey={props.tab}
        onChange={open}
        items={BIRTHDAY_TABS.map((tab) => ({
          key: tab,
          label: t(`tabs.${tab}`),
          children: tab === props.tab ? <Spin spinning={switching}>{panel}</Spin> : null,
        }))}
      />
    </>
  );
}

interface ListPanelProps {
  guildId: string;
  entries: readonly BirthdayEntryView[];
  month: number | undefined;
  pending: boolean;
  chooseMonth: (month: number | undefined) => void;
}

function ListPanel({ guildId, entries, month, pending, chooseMonth }: ListPanelProps) {
  const t = useTranslations('web-birthday');
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={16}>
        {entries.length === 0 && month === undefined ? (
          <PageState
            status="info"
            headingLevel={2}
            title={t('empty.title')}
            body={t('empty.body')}
            action={{
              label: t('empty.action'),
              onClick: () => document.getElementById(BIRTHDAY_ADD_FIRST_FIELD_ID)?.focus(),
            }}
          />
        ) : (
          <>
            <div style={{ marginBottom: 'var(--space-3)', maxWidth: 'var(--w-sm)' }}>
              <Select
                aria-label={t('filter.label')}
                value={month ?? 0}
                loading={pending}
                onChange={(value: number) => chooseMonth(value === 0 ? undefined : value)}
                options={[
                  { value: 0, label: t('filter.all') },
                  ...MONTHS.map((value) => ({
                    value,
                    label: t('filter.month', { month: value }),
                  })),
                ]}
                style={{ width: '100%' }}
              />
            </div>
            <BirthdayTable guildId={guildId} entries={entries} filtered={month !== undefined} />
          </>
        )}
      </Col>
      <Col xs={24} xl={8}>
        <FormColumn>
          <BirthdayAddForm guildId={guildId} />
          <BirthdayImport guildId={guildId} />
        </FormColumn>
      </Col>
    </Row>
  );
}
