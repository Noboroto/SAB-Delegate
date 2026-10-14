'use client';

import { useCallback } from 'react';
import { App } from 'antd';

/**
 * Copies text and tells the person whether it worked. Browsers refuse the
 * clipboard outside a secure page or without permission; the text is never logged.
 */
export function useCopyToClipboard() {
  const { message } = App.useApp();

  return useCallback(
    async (text: string, messages: { done: string; failed: string }) => {
      try {
        await navigator.clipboard.writeText(text);
        void message.success(messages.done);
      } catch {
        void message.error(messages.failed);
      }
    },
    [message],
  );
}
