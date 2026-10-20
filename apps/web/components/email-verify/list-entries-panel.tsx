'use client';

import { useMemo, useRef, useState } from 'react';
import { App, Button, Input, Popconfirm, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  EMAIL_LIST_BATCH_MAX,
  EMAIL_LIST_ENTRIES_MAX,
  type EmailListEntriesResult,
  type EmailListSummary,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import {
  addEmailListEntries,
  clearEmailListEntries,
  removeEmailListEntries,
} from '@/lib/email-verify/email-verify-api';
import { chunk, parseEmailText } from '@/lib/email-verify/parse-emails';

const FILE_MAX_MB = 2;
const FILE_MAX_BYTES = FILE_MAX_MB * 1024 * 1024;

type Mode = 'add' | 'remove';

/** Adds addresses to a list, or takes them off it, from pasted text or a CSV/TXT file. */
export function ListEntriesPanel({ guildId, list }: { guildId: string; list: EmailListSummary }) {
  const t = useTranslations('web-email-verify.lists');
  const { message } = App.useApp();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<EmailListEntriesResult | undefined>(undefined);
  const [overflow, setOverflow] = useState<number | undefined>(undefined);
  // Parsed once per change of the text, not on every render of the panel.
  const parsed = useMemo(() => parseEmailText(text), [text]);

  const apply = useApiMutation(async (mode: Mode): Promise<EmailListEntriesResult> => {
    const { emails, ignored } = parsed;
    const total: EmailListEntriesResult = { changed: 0, skipped: 0, invalid: ignored };
    const call = mode === 'add' ? addEmailListEntries : removeEmailListEntries;
    // A big file goes in runs the server accepts; the totals of the runs are what is shown.
    for (const run of chunk(emails, EMAIL_LIST_BATCH_MAX)) {
      const part = await call(guildId, list.id, { emails: run });
      total.changed += part.changed;
      total.skipped += part.skipped;
      total.invalid += part.invalid;
    }
    return total;
  });
  const clear = useApiMutation(() => clearEmailListEntries(guildId, list.id));
  const busy = apply.pending || clear.pending;
  const hasEmails = parsed.emails.length > 0;

  const onApply = async (mode: Mode) => {
    clear.reset();
    setResult(undefined);
    setOverflow(undefined);
    // Refused up front: the list would end up over its cap and the runs sent so far would stay.
    if (mode === 'add' && list.entryCount + parsed.emails.length > EMAIL_LIST_ENTRIES_MAX) {
      setOverflow(parsed.emails.length);
      return;
    }
    const outcome = await apply.run(mode);
    if (outcome === undefined) return;
    // A failed run may have stored its first runs; the count in the table is the server's.
    router.refresh();
    if (!outcome.ok) return;
    setResult(outcome.data);
    setText('');
    setFileName(undefined);
  };

  const onClear = async () => {
    apply.reset();
    setResult(undefined);
    setOverflow(undefined);
    const outcome = await clear.run(undefined);
    if (outcome?.ok !== true) return;
    void message.success(t('cleared'));
    router.refresh();
  };

  const onFile = async (file: File | undefined) => {
    setFileError(undefined);
    if (file === undefined) return;
    if (file.size > FILE_MAX_BYTES) {
      setFileError(t('fileTooLarge', { max: FILE_MAX_MB }));
      return;
    }
    try {
      const content = await file.text();
      setText((current) => (current.trim() === '' ? content : `${current}\n${content}`));
      setFileName(file.name);
    } catch {
      setFileError(t('fileUnreadable'));
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
        <label htmlFor={`ev-entries-${list.id}`}>{t('entries', { name: list.name })}</label>
        <Input.TextArea
          id={`ev-entries-${list.id}`}
          value={text}
          disabled={busy}
          autoSize={{ minRows: 4, maxRows: 10 }}
          spellCheck={false}
          onChange={(event) => {
            setOverflow(undefined);
            setText(event.target.value);
          }}
        />
        <Typography.Text type="secondary">{t('addEmailsHelp')}</Typography.Text>
      </div>
      <ActionRow>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          hidden
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            // The same file chosen again must still fire a change.
            event.target.value = '';
          }}
        />
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>
          {t('upload')}
        </Button>
        <Typography.Text type="secondary">{fileName ?? t('noFile')}</Typography.Text>
      </ActionRow>
      {fileError === undefined ? null : (
        <Typography.Text type="danger" role="alert">
          {fileError}
        </Typography.Text>
      )}
      {overflow === undefined ? null : (
        <Typography.Text type="danger" role="alert">
          {t('tooManyEntries', {
            max: EMAIL_LIST_ENTRIES_MAX,
            count: list.entryCount,
            adding: overflow,
          })}
        </Typography.Text>
      )}
      {result === undefined ? null : (
        <Typography.Text role="status">{t('result', { ...result })}</Typography.Text>
      )}
      {apply.error === undefined && clear.error === undefined ? null : (
        <ErrorAlert error={apply.error ?? clear.error} />
      )}
      <ActionRow>
        <Button
          type="primary"
          loading={apply.pending}
          disabled={busy || !hasEmails}
          onClick={() => void onApply('add')}
        >
          {t('add')}
        </Button>
        <Button disabled={busy || !hasEmails} onClick={() => void onApply('remove')}>
          {t('remove')}
        </Button>
        <Popconfirm
          title={t('clearConfirm', { name: list.name })}
          okText={t('clear')}
          okButtonProps={{ danger: true }}
          onConfirm={() => void onClear()}
          disabled={busy || list.entryCount === 0}
        >
          <Button danger loading={clear.pending} disabled={busy || list.entryCount === 0}>
            {t('clear')}
          </Button>
        </Popconfirm>
      </ActionRow>
    </div>
  );
}
