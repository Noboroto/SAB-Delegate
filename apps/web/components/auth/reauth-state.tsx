'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/ui/page-state';
import { signInWithDiscord } from '@/lib/auth/auth-client';

/** The login no longer carries what the server list needs (the Discord token): sign in again. */
export function ReauthState() {
  const t = useTranslations('servers.reauth');
  const [starting, setStarting] = useState(false);
  // State updates land after the event: two clicks in one frame would both see
  // `starting === false`. The ref flips at once, so only the first starts a sign-in.
  const started = useRef(false);

  const start = () => {
    if (started.current) return;
    started.current = true;
    setStarting(true);
    signInWithDiscord().catch((error: unknown) => {
      console.error(error);
      started.current = false;
      setStarting(false);
    });
  };

  return (
    <PageState
      status="info"
      title={t('title')}
      body={t('body')}
      action={{ label: t('action'), onClick: start, loading: starting }}
    />
  );
}
