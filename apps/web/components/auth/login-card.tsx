'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Alert, Button, Card, Typography, theme } from 'antd';
import { useTranslations } from 'next-intl';
import { signInWithDiscord } from '@/lib/auth/auth-client';

export function LoginCard({ next }: { next: string }) {
  const t = useTranslations('login');
  const { token } = theme.useToken();
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
    <Card style={{ width: '100%', maxWidth: 'var(--w-lg)' }}>
      <Image
        src="/brand/sab-logo.png"
        alt="SAB"
        width={144}
        height={60}
        unoptimized
        preload
        style={{ display: 'block', marginBottom: 'var(--space-4)' }}
      />
      <Typography.Title
        level={1}
        style={{
          marginTop: 0,
          fontSize: token.fontSizeHeading3,
          lineHeight: token.lineHeightHeading3,
        }}
      >
        {t('title')}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t('subtitle')}</Typography.Paragraph>
      {failed ? (
        <Alert
          type="error"
          showIcon
          title={t('startFailed')}
          style={{ marginBottom: 'var(--space-4)' }}
        />
      ) : null}
      <Button type="primary" block loading={starting} onClick={() => void start()}>
        {t('signInWithDiscord')}
      </Button>
      <Typography.Paragraph
        type="secondary"
        style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}
      >
        {t('access')}
      </Typography.Paragraph>
      <Typography.Paragraph
        type="secondary"
        style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}
      >
        {t('privacy')}
      </Typography.Paragraph>
    </Card>
  );
}
