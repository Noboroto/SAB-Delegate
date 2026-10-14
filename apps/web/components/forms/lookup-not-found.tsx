'use client';

import { Button, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import type { LookupState } from '@/lib/discord/use-lookup';

/** What an open picker shows instead of options: loading, a failed read with a retry, a hint, or "no results". */
export function LookupNotFound({
  state,
  emptyText,
}: {
  state: Pick<LookupState<unknown>, 'loading' | 'error' | 'reload'>;
  /** Shown when there is nothing to list and nothing is loading or failed. */
  emptyText?: string;
}) {
  const t = useTranslations('web-common');

  if (state.loading) {
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8 }}>
        <Spin size="small" />
        <span>{t('picker.loading')}</span>
      </div>
    );
  }
  if (state.error !== undefined) {
    return (
      <div style={{ display: 'grid', gap: 8, padding: 8 }}>
        <span>{t('picker.loadFailed')}</span>
        <Button onClick={state.reload}>{t('retry')}</Button>
      </div>
    );
  }
  return <div style={{ padding: 8 }}>{emptyText ?? t('picker.noResults')}</div>;
}
