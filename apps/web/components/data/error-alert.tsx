'use client';

import { Alert, Button } from 'antd';
import { useTranslations } from 'next-intl';
import { useApiErrorMessage } from '@/lib/api/mutations';

interface ErrorAlertProps {
  /** Whatever a failed call threw; only its server error code is read. */
  error: unknown;
  /** Adds a retry button for a read that can simply be asked again. */
  onRetry?: () => void;
  retrying?: boolean;
}

/** A failed call as one translated sentence (never the error's own text), with an optional retry. */
export function ErrorAlert({ error, onRetry, retrying = false }: ErrorAlertProps) {
  const t = useTranslations('web-common');
  const messageOf = useApiErrorMessage();

  return (
    <Alert
      type="error"
      showIcon
      title={messageOf(error)}
      action={
        onRetry === undefined ? undefined : (
          <Button onClick={onRetry} loading={retrying}>
            {t('retry')}
          </Button>
        )
      }
    />
  );
}
