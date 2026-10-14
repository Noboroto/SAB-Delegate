'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { App, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import viVN from 'antd/locale/vi_VN';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { useLocale } from 'next-intl';
// AntD hands its date picker `vi` as a dayjs locale name, and an unregistered
// name silently falls back to English.
import 'dayjs/locale/vi';
import {
  THEME_COOKIE_MAX_AGE_SECONDS,
  THEME_MODE_COOKIE,
  THEME_RESOLVED_COOKIE,
  type ResolvedTheme,
  type ThemeMode,
} from '@/lib/theme';
import { GlobalErrorListener } from './global-error-listener';
import { darkTheme, lightTheme } from './theme-config';

/** AntD's 3 s default is too short to read a sentence. */
const TOAST_DURATION_SECONDS = 5;

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) throw new Error('useTheme must be used within <ThemeProvider>');
  return context;
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function systemPreference(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeProviderProps {
  /** What the server rendered from the cookies; the first client render must match it. */
  initialMode: ThemeMode;
  initialResolved: ResolvedTheme;
  children: React.ReactNode;
}

export function ThemeProvider({ initialMode, initialResolved, children }: ThemeProviderProps) {
  const locale = useLocale();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(initialResolved);

  useEffect(() => {
    const apply = () => {
      const next = mode === 'system' ? systemPreference() : mode;
      setResolved(next);
      document.documentElement.setAttribute('data-theme', next);
      writeCookie(THEME_RESOLVED_COOKIE, next);
    };
    apply();
    if (mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeCookie(THEME_MODE_COOKIE, next);
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

  return (
    <AntdRegistry>
      <ConfigProvider
        // AntD writes some strings itself (empty states, pagination, validation)
        // and they stay English until told otherwise.
        locale={locale === 'en' ? enUS : viVN}
        theme={resolved === 'dark' ? darkTheme : lightTheme}
      >
        <App message={{ duration: TOAST_DURATION_SECONDS }}>
          <GlobalErrorListener />
          <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
        </App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
