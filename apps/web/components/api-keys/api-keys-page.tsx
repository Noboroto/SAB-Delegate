'use client';

import { useState } from 'react';
import { PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { App, Button, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_KEY_MAX_ACTIVE, type ApiKeyView } from '@sab/shared';
import { ActionRow } from '@/components/ui/action-row';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { PageState } from '@/components/ui/page-state';
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {keys.length === 0 ? (
          // The one next step on an empty page is the primary button; the toolbar one stays out.
          <PageState
            status="info"
            headingLevel={2}
            title={t('emptyTitle')}
            body={t('empty')}
            action={{ label: t('create'), onClick: () => setCreating(true) }}
          />
        ) : (
          <>
            <ActionRow>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={limitReached}
                onClick={() => setCreating(true)}
              >
                {t('create')}
              </Button>
              {limitReached ? (
                <Typography.Text type="warning">
                  <WarningOutlined aria-hidden /> {t('limitReached', { max: API_KEY_MAX_ACTIVE })}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">
                  {t('usage', { count: active, max: API_KEY_MAX_ACTIVE })}
                </Typography.Text>
              )}
            </ActionRow>
            <ApiKeysTable keys={keys} now={now} />
          </>
        )}
        <FormColumn>
          <ConnectBox />
        </FormColumn>
      </div>
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
