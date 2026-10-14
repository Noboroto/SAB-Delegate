'use client';

import { Col, Row, Select } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { BirthdayEntryView } from '@sab/shared';
import { Heading } from '@/components/ui/heading';
import { BirthdayAddForm } from './birthday-add-form';
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

  // The month lives in the URL so the server does the filtering and a reload keeps it.
  const chooseMonth = (next: number | undefined) =>
    router.push(next === undefined ? pathname : `${pathname}?month=${next}`);

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <div style={{ marginBottom: 12, maxWidth: 240 }}>
            <Select
              aria-label={t('filter.label')}
              value={month ?? 0}
              onChange={(value: number) => chooseMonth(value === 0 ? undefined : value)}
              options={[
                { value: 0, label: t('filter.all') },
                ...MONTHS.map((value) => ({ value, label: t('filter.month', { month: value }) })),
              ]}
              style={{ width: '100%' }}
            />
          </div>
          <BirthdayTable guildId={guildId} entries={entries} filtered={month !== undefined} />
        </Col>
        <Col xs={24} xl={8}>
          <div style={{ display: 'grid', gap: 16 }}>
            <BirthdayAddForm guildId={guildId} />
            <BirthdayImport guildId={guildId} />
          </div>
        </Col>
      </Row>
    </>
  );
}
