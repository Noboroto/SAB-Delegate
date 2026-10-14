'use client';

import { useState } from 'react';
import { Alert, Button, Card, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { signInWithDiscord } from '@/lib/auth/auth-client';

export function LoginCard({ next }: { next: string }) {
  const t = useTranslations('login');
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = async () => {
    // One click starts one redirect: the button stays disabled until the page leaves.
    setStarting(true);
    setFailed(false);
    try {
      await signInWithDiscord(next);
    } catch (error) {
      console.error(error);
      setFailed(true);
      setStarting(false);
    }
  };

  return (
    <Card style={{ width: '100%', maxWidth: 420 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {t('title')}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t('subtitle')}</Typography.Paragraph>
      {failed ? (
        <Alert type="error" showIcon title={t('startFailed')} style={{ marginBottom: 16 }} />
      ) : null}
      <Button type="primary" block loading={starting} onClick={() => void start()}>
        {starting ? t('redirecting') : t('signInWithDiscord')}
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        {t('access')}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        {t('privacy')}
      </Typography.Paragraph>
    </Card>
  );
}
