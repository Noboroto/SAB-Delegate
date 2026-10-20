'use client';

import { useState } from 'react';
import { App, Button, Card, Select, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EMAIL_BLOCK_PATTERNS_MAX, EmailBlocklistSchema, type EmailBlocklist } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { saveEmailBlocklist } from '@/lib/email-verify/email-verify-api';

const SEPARATORS = [' ', ',', ';', '\n'];

const normalise = (patterns: readonly string[]) => [
  ...new Set(patterns.map((pattern) => pattern.trim().toLowerCase()).filter((p) => p !== '')),
];

/** The patterns whose addresses are always refused, edited as tags: type one, press Enter. */
export function BlocklistCard({
  guildId,
  blocklist,
}: {
  guildId: string;
  blocklist: EmailBlocklist;
}) {
  const t = useTranslations('web-email-verify.blocklist');
  const { message } = App.useApp();
  const router = useRouter();
  const [patterns, setPatterns] = useState<string[]>(blocklist.patterns);
  const save = useApiMutation((input: EmailBlocklist) => saveEmailBlocklist(guildId, input));

  const invalid = patterns.filter(
    (pattern) => !EmailBlocklistSchema.safeParse({ patterns: [pattern] }).success,
  );
  const tooMany = patterns.length > EMAIL_BLOCK_PATTERNS_MAX;
  const changed = JSON.stringify(patterns) !== JSON.stringify(blocklist.patterns);

  const onSave = async () => {
    const parsed = EmailBlocklistSchema.safeParse({ patterns });
    if (!parsed.success) return;
    const outcome = await save.run(parsed.data);
    if (outcome?.ok !== true) return;
    void message.success(t('saved'));
    router.refresh();
  };

  return (
    <Card title={t('title')}>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Typography.Text type="secondary">{t('intro')}</Typography.Text>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="ev-blocklist">{t('patterns')}</label>
          <Select
            id="ev-blocklist"
            mode="tags"
            open={false}
            suffix={null}
            tokenSeparators={SEPARATORS}
            placeholder={t('placeholder')}
            value={patterns}
            status={invalid.length > 0 || tooMany ? 'error' : undefined}
            disabled={save.pending}
            onChange={(next: string[]) => {
              save.reset();
              setPatterns(normalise(next));
            }}
            style={{ width: '100%' }}
          />
          <Typography.Text type="secondary">
            {t('help', { max: EMAIL_BLOCK_PATTERNS_MAX })}
          </Typography.Text>
        </div>
        {invalid.length === 0 ? null : (
          <Typography.Text type="danger" role="alert">
            {t('invalid', { patterns: invalid.join(', ') })}
          </Typography.Text>
        )}
        {save.error === undefined ? null : <ErrorAlert error={save.error} />}
        <ActionRow>
          <Button
            type="primary"
            loading={save.pending}
            disabled={!changed || invalid.length > 0 || tooMany}
            onClick={() => void onSave()}
          >
            {t('save')}
          </Button>
        </ActionRow>
      </div>
    </Card>
  );
}
