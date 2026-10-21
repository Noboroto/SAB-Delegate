'use client';

import { useTransition } from 'react';
import { Col, Row, Select } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { BirthdayEntryView } from '@sab/shared';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { PageState } from '@/components/ui/page-state';
import { BirthdayAddForm, BIRTHDAY_ADD_FIRST_FIELD_ID } from './birthday-add-form';
import { BirthdayImport } from './birthday-import';
import { BirthdayTable } from './birthday-table';

interface BirthdayPageProps {
  guildId: string;
  entries: readonly BirthdayEntryView[];
  /** The month the server filtered by; `undefined` is every month. */
  month: number | undefined;
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

export function BirthdayPage({ guildId, entries, month }: BirthdayPageProps) {
  const t = useTranslations('web-birthday');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // The month lives in the URL so the server does the filtering and a reload keeps it.
  const chooseMonth = (next: number | undefined) =>
    startTransition(() => router.push(next === undefined ? pathname : `${pathname}?month=${next}`));

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
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
    </>
  );
}
