'use client';

import { useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Space, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_KEY_MAX_ACTIVE, type ApiKeyView } from '@sab/shared';
import { Heading } from '@/components/ui/heading';
import { countActiveKeys } from '@/lib/api-keys/key-status';
import { ApiKeysTable } from './api-keys-table';
import { ConnectBox } from './connect-box';
import { CreateKeyModal } from './create-key-modal';
import { SecretModal } from './secret-modal';

/** The signed-in person's API keys: list, create (secret shown once), revoke, and how to connect. */
export function ApiKeysPage({ keys }: { keys: readonly ApiKeyView[] }) {
  const t = useTranslations('web-api-keys');
  const { message } = App.useApp();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  // The only place the secret lives; clearing it on close is what makes it shown once.
  const [secret, setSecret] = useState<string | undefined>(undefined);

  const now = Date.now();
  const active = countActiveKeys(keys, now);
  const limitReached = active >= API_KEY_MAX_ACTIVE;

  return (
    <>
      <Heading title={t('pageTitle')} subtitle={t('subtitle')} />
      <Space orientation="vertical" size={16} style={{ display: 'flex' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={limitReached}
            onClick={() => setCreating(true)}
          >
            {t('create')}
          </Button>
          <Typography.Text type={limitReached ? 'warning' : 'secondary'}>
            {limitReached
              ? t('limitReached', { max: API_KEY_MAX_ACTIVE })
              : t('usage', { count: active, max: API_KEY_MAX_ACTIVE })}
          </Typography.Text>
        </div>
        <ApiKeysTable keys={keys} now={now} />
        <ConnectBox />
      </Space>
      <CreateKeyModal
        open={creating}
        onClose={() => setCreating(false)}
        onMinted={(key) => {
          setCreating(false);
          setSecret(key.plaintext);
          void message.success(t('created'));
          router.refresh();
        }}
      />
      {secret !== undefined && <SecretModal secret={secret} onClose={() => setSecret(undefined)} />}
    </>
  );
}
