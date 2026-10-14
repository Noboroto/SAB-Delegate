'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/ui/page-state';
import { signInWithDiscord } from '@/lib/auth/auth-client';

/** The login no longer carries what the server list needs (the Discord token): sign in again. */
export function ReauthState() {
  const t = useTranslations('servers.reauth');
  const [starting, setStarting] = useState(false);

  return (
    <PageState
      status="info"
      title={t('title')}
      body={t('body')}
      action={{
        label: t('action'),
        onClick: () => {
          if (starting) return;
          setStarting(true);
          signInWithDiscord().catch((error: unknown) => {
            console.error(error);
            setStarting(false);
          });
        },
      }}
    />
  );
}
