'use client';

import { CopyOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from './use-copy-to-clipboard';

interface SecretModalProps {
  /** The one-time secret. Mount the modal only while there is one: the unmount is what removes it from the page. */
  secret: string;
  onClose: () => void;
}

/**
 * Shows a freshly minted key. It can only be closed on purpose (no mask click,
 * no Escape): closing is the moment the secret is gone for good. The parent
 * unmounts it at once, because a closing modal keeps its content on screen
 * until the leave animation ends.
 */
export function SecretModal({ secret, onClose }: SecretModalProps) {
  const t = useTranslations('web-api-keys.secret');
  const copy = useCopyToClipboard();

  return (
    <Modal
      open
      title={t('title')}
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      footer={
        <Button type="primary" onClick={onClose}>
          {t('done')}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Alert type="warning" showIcon title={t('warning')} />
        <Space.Compact style={{ width: '100%' }}>
          <Input
            readOnly
            value={secret}
            aria-label={t('label')}
            onFocus={(event) => event.target.select()}
            style={{ fontFamily: 'var(--font-mono, monospace)' }}
          />
          <Button
            icon={<CopyOutlined />}
            aria-label={t('copy')}
            onClick={() => void copy(secret, { done: t('copied'), failed: t('copyFailed') })}
          />
        </Space.Compact>
      </div>
    </Modal>
  );
}
