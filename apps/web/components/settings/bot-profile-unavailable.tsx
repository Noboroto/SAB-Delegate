'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from 'antd';
import { useTranslations } from 'next-intl';

/** The bot's name and picture could not be read; the rest of the page still works. */
export function BotProfileUnavailable() {
  const t = useTranslations('web-settings.botProfile');
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <Alert
      type="info"
      showIcon
      title={t('title')}
      description={t('unavailable')}
      action={
        <Button loading={refreshing} onClick={() => startRefresh(() => router.refresh())}>
          {t('retry')}
        </Button>
      }
    />
  );
}
