'use client';

import type { ReactNode } from 'react';
import { Spin, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { ErrorAlert } from './error-alert';

export type DryRunPreviewState<TPlan> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; plan: TPlan };

interface DryRunPreviewProps<TPlan> {
  state: DryRunPreviewState<TPlan>;
  /** Draws the plan the service returned; the web never computes one itself. */
  renderPlan: (plan: TPlan) => ReactNode;
  onRetry: () => void;
}

/** What a destructive call would do, exactly as the service reported it for a `dryRun` request. */
export function DryRunPreview<TPlan>({ state, renderPlan, onRetry }: DryRunPreviewProps<TPlan>) {
  const t = useTranslations('web-common');

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-label={t('dryRun.loading')}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <Spin size="small" />
        <span>{t('dryRun.loading')}</span>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorAlert error={state.error} onRetry={onRetry} />;

  return (
    <section aria-label={t('dryRun.title')}>
      <Typography.Text strong>{t('dryRun.title')}</Typography.Text>
      <div style={{ marginTop: 8 }}>{renderPlan(state.plan)}</div>
    </section>
  );
}
