'use client';

import { App, Button, Popconfirm } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApiErrorMessage, useApiMutation } from '@/lib/api/mutations';
import { revokeApiKey } from '@/lib/api-keys/api-keys-api';

/**
 * Revoking has no dry run (the key is just switched off), so the confirm says
 * what follows. The popconfirm's own button shows the pending state.
 */
export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations('web-api-keys.revoke');
  const { message } = App.useApp();
  const router = useRouter();
  const messageOf = useApiErrorMessage();
  const revoke = useApiMutation(revokeApiKey);

  const confirm = async () => {
    const outcome = await revoke.run(id);
    if (outcome === undefined) return;
    if (outcome.ok) {
      void message.success(t('done'));
      router.refresh();
    } else {
      void message.error(messageOf(outcome.error));
    }
  };

  return (
    <Popconfirm
      title={t('title', { name })}
      description={t('body')}
      okText={t('confirm')}
      cancelText={t('cancel')}
      okButtonProps={{ danger: true }}
      onConfirm={() => void confirm()}
    >
      <Button danger size="small" loading={revoke.pending} aria-label={t('actionLabel', { name })}>
        {t('action')}
      </Button>
    </Popconfirm>
  );
}
