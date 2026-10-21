'use client';

import { App, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { revokeApiKey } from '@/lib/api-keys/api-keys-api';

/**
 * Revoking has no dry run (the key is just switched off), so the plan is the
 * sentence saying what follows; the confirm modal reports a failed call itself.
 */
export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations('web-api-keys.revoke');
  const { message } = App.useApp();
  const router = useRouter();

  return (
    <ConfirmAction
      label={t('action')}
      ariaLabel={t('actionLabel', { name })}
      modalTitle={t('title', { name })}
      confirmLabel={t('confirm')}
      preview={() => Promise.resolve(undefined)}
      execute={() => revokeApiKey(id)}
      renderPlan={() => (
        <Typography.Paragraph style={{ margin: 0 }}>{t('body')}</Typography.Paragraph>
      )}
      onDone={() => {
        void message.success(t('done'));
        router.refresh();
      }}
    />
  );
}
