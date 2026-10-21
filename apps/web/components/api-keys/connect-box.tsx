'use client';

import { useSyncExternalStore } from 'react';
import { CopyOutlined } from '@ant-design/icons';
import { Button, Card, Typography, theme } from 'antd';
import { useTranslations } from 'next-intl';
import { ActionRow } from '@/components/ui/action-row';
import { mcpConfigSnippet, mcpUrl } from '@/lib/api-keys/mcp-config';
import { useCopyToClipboard } from './use-copy-to-clipboard';

const subscribeNothing = () => () => undefined;
const browserOrigin = () => window.location.origin;
// The server cannot know which address the visitor used; the first paint shows a neutral one.
const serverOrigin = () => 'https://your-domain';

/** How to point an AI tool at this site. Shows the key only as an environment variable, never a real one. */
export function ConnectBox() {
  const t = useTranslations('web-api-keys.connect');
  const origin = useSyncExternalStore(subscribeNothing, browserOrigin, serverOrigin);
  const { token } = theme.useToken();
  const copy = useCopyToClipboard();
  const url = mcpUrl(origin);
  const snippet = mcpConfigSnippet(origin);

  return (
    <Card title={t('title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>{t('intro')}</Typography.Paragraph>
        <div>
          <Typography.Text strong>{t('urlLabel')}</Typography.Text>
          <ActionRow>
            <Typography.Text code style={{ overflowWrap: 'anywhere' }}>
              {url}
            </Typography.Text>
            <Button
              icon={<CopyOutlined />}
              aria-label={t('copyUrl')}
              onClick={() => void copy(url, { done: t('copied'), failed: t('copyFailed') })}
            />
          </ActionRow>
        </div>
        <div>
          <Typography.Text strong>{t('fileLabel')}</Typography.Text>
          <pre
            style={{
              margin: 'var(--space-1) 0 var(--space-2)',
              padding: 'var(--space-3)',
              overflowX: 'auto',
              border: '1px solid var(--border)',
              borderRadius: token.borderRadius,
            }}
          >
            <code>{snippet}</code>
          </pre>
          <Button
            icon={<CopyOutlined />}
            onClick={() => void copy(snippet, { done: t('copied'), failed: t('copyFailed') })}
          >
            {t('copySnippet')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
