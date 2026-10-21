'use client';

import { useEffect } from 'react';
import { touchSession } from '@/lib/auth/auth-client';

/** The most often a returning focus re-reads the session. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Keeps a daily user signed in past the session's fixed lifetime: reads the
 * session once per page load and again on window focus, at most hourly.
 * Renders nothing.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    let last = Date.now();
    void touchSession();
    const onFocus = () => {
      if (Date.now() - last < SESSION_TOUCH_INTERVAL_MS) return;
      last = Date.now();
      void touchSession();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return null;
}
