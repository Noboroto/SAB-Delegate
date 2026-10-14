'use client';

import { App, Button } from 'antd';
import { useTranslations } from 'next-intl';

/** Puts `text` on the clipboard; a browser that refuses (no permission, insecure page) is told so, not ignored. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useTranslations('web-tools');
  const { message } = App.useApp();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      void message.success(t('common.copied'));
    } catch {
      void message.error(t('common.copyFailed'));
    }
  };

  return <Button onClick={() => void copy()}>{label ?? t('common.copy')}</Button>;
}
