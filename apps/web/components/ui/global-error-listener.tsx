'use client';

import { useEffect, useRef } from 'react';
import { App } from 'antd';
import { useTranslations } from 'next-intl';

/** At most one error toast per window, so a failing loop cannot bury the page. */
const TOAST_THROTTLE_MS = 5000;

/** Next uses rejections with this digest prefix for redirect() and notFound(). */
const NEXT_INTERNAL_DIGEST_PREFIX = 'NEXT_';

function isNextControlFlow(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null || !('digest' in reason)) return false;
  const { digest } = reason as { digest?: unknown };
  return typeof digest === 'string' && digest.startsWith(NEXT_INTERNAL_DIGEST_PREFIX);
}

/**
 * Last-resort net for errors that escape every boundary (a rejected promise in
 * an event handler, a throw outside render): logs them and shows one translated
 * toast. It never shows the error's own text.
 */
export function GlobalErrorListener() {
  const t = useTranslations('web');
  const { message } = App.useApp();
  const lastToastAt = useRef(0);

  useEffect(() => {
    const notify = () => {
      const now = Date.now();
      if (now - lastToastAt.current < TOAST_THROTTLE_MS) return;
      lastToastAt.current = now;
      void message.error(t('genericError'));
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (isNextControlFlow(event.reason)) return;
      console.error('Unhandled promise rejection:', event.reason);
      notify();
    };

    const onError = (event: ErrorEvent) => {
      // A failed <img>/<script> load, or a muted cross-origin error from a
      // browser extension, carries no error object: nothing to diagnose or show.
      if (event.error == null) return;
      console.error('Unhandled error:', event.error);
      notify();
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, [message, t]);

  return null;
}
