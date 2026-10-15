'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Alert, App, Button, Card, Space, Table, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BIRTHDAY_CSV_HEADER, BIRTHDAY_CSV_TEMPLATE, type BirthdayImportReport } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { importBirthdays } from '@/lib/birthday/birthday-api';
import { BIRTHDAY_CSV_MAX_BYTES, downloadBirthdayTemplate } from '@/lib/birthday/csv-template';

type ImportProblem = BirthdayImportReport['problems'][number];

const LISTED_IDS = 10;

interface ImportRequest {
  csv: string;
  dryRun: boolean;
}

/**
 * Two steps on purpose: the file is sent once as a preview, the person reads
 * what the service says it would add, skip and refuse, and only then is the same
 * text sent to run for real.
 */
export function BirthdayImport({ guildId }: { guildId: string }) {
  const t = useTranslations('web-birthday');
  const { message } = App.useApp();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<'tooLarge' | 'unreadable' | undefined>(undefined);
  const [report, setReport] = useState<BirthdayImportReport | undefined>(undefined);
  const send = useApiMutation((request: ImportRequest) =>
    importBirthdays(guildId, request.csv, request.dryRun),
  );

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReport(undefined);
    send.reset();
    setFileError(undefined);
    if (file === undefined) return;
    if (file.size > BIRTHDAY_CSV_MAX_BYTES) {
      setCsv(undefined);
      setFileName(file.name);
      setFileError('tooLarge');
      return;
    }
    try {
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
    } catch {
      setCsv(undefined);
      setFileName(file.name);
      setFileError('unreadable');
    }
  };

  const check = async () => {
    if (csv === undefined) return;
    const outcome = await send.run({ csv, dryRun: true });
    if (outcome?.ok === true) setReport(outcome.data);
  };

  const confirm = async () => {
    if (csv === undefined) return;
    const outcome = await send.run({ csv, dryRun: false });
    if (outcome?.ok !== true) return;
    void message.success(t('import.done', { count: outcome.data.added }));
    setReport(undefined);
    setCsv(undefined);
    setFileName(undefined);
    router.refresh();
  };

  const rejectedFormat = send.code === 'VALIDATION_FAILED';

  return (
    <Card title={t('import.title')}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {t('import.help', { columns: BIRTHDAY_CSV_HEADER.join(', ') })}
        </Typography.Paragraph>
        <ActionRow>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label={t('import.fileInput')}
            style={{ display: 'none' }}
            onChange={(event) => void choose(event)}
          />
          <Button onClick={() => input.current?.click()} disabled={send.pending}>
            {t('import.chooseFile')}
          </Button>
          <Button onClick={() => downloadBirthdayTemplate(t('import.templateName'))}>
            {t('import.template')}
          </Button>
          <Typography.Text type="secondary">{fileName ?? t('import.noFile')}</Typography.Text>
        </ActionRow>
        {fileError === undefined ? null : (
          <Alert
            type="error"
            showIcon
            title={fileError === 'tooLarge' ? t('import.fileTooLarge') : t('import.fileUnreadable')}
          />
        )}
        {rejectedFormat ? (
          <Alert
            type="warning"
            showIcon
            title={t('import.badFormat')}
            description={
              <>
                <p>{t('import.badFormatBody')}</p>
                <pre style={{ margin: 0, overflowX: 'auto' }}>{BIRTHDAY_CSV_TEMPLATE}</pre>
              </>
            }
          />
        ) : null}
        {send.error === undefined ? null : <ErrorAlert error={send.error} />}
        {/* The confirm button below becomes the card's one primary once a report is on screen. */}
        <Button
          type={report === undefined ? 'primary' : 'default'}
          onClick={() => void check()}
          loading={send.pending && report === undefined}
          disabled={csv === undefined || send.pending}
        >
          {t('import.preview')}
        </Button>
        {report === undefined ? null : (
          <ImportReport report={report} pending={send.pending} onConfirm={() => void confirm()} />
        )}
      </Space>
    </Card>
  );
}

function ImportReport({
  report,
  pending,
  onConfirm,
}: {
  report: BirthdayImportReport;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations('web-birthday');
  const listed = report.duplicates.slice(0, LISTED_IDS);
  const hidden = report.duplicates.length - listed.length;

  return (
    <section aria-label={t('import.report.title')}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Title level={3} style={{ fontSize: 16, margin: 0 }}>
          {t('import.report.title')}
        </Typography.Title>
        <ul style={{ margin: 0 }}>
          <li>{t('import.report.total', { count: report.total })}</li>
          <li>{t('import.report.added', { count: report.added })}</li>
          <li>{t('import.report.duplicates', { count: report.duplicates.length })}</li>
          <li>{t('import.report.problems', { count: report.problems.length })}</li>
        </ul>
        {report.sample.length === 0 ? null : (
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {t('import.report.sample', { names: report.sample.join(', ') })}
          </Typography.Paragraph>
        )}
        {listed.length === 0 ? null : (
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {t('import.report.duplicateList', {
              ids:
                listed.join(', ') +
                (hidden > 0 ? `, ${t('import.report.more', { count: hidden })}` : ''),
            })}
          </Typography.Paragraph>
        )}
        {report.problems.length === 0 ? null : (
          <Table<ImportProblem>
            size="small"
            rowKey={(problem) => `${problem.row}-${problem.kind}`}
            dataSource={report.problems}
            pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: t('import.problem.columnRow'), dataIndex: 'row' },
              {
                title: t('import.problem.columnStudentId'),
                dataIndex: 'studentId',
                render: (id: string | undefined) => id ?? '-',
              },
              {
                title: t('import.problem.columnReason'),
                dataIndex: 'kind',
                render: (kind: ImportProblem['kind']) => t(`import.problem.kind.${kind}`),
              },
            ]}
          />
        )}
        {report.added === 0 ? (
          <Alert type="info" showIcon title={t('import.report.nothingToAdd')} />
        ) : (
          <Button type="primary" onClick={onConfirm} loading={pending} disabled={pending}>
            {t('import.confirm', { count: report.added })}
          </Button>
        )}
      </Space>
    </section>
  );
}
