import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodeSchema, MESSAGES } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';

const stored = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'locale' && stored.locale !== undefined ? { value: stored.locale } : undefined,
    }),
}));
vi.mock('next-intl/server', () => ({ getRequestConfig: <T>(factory: T) => factory }));

import { WEB_NAMESPACES, webMessages } from '@/lib/web-messages';
import requestConfig, { resolveLocale } from './request';

const MESSAGES_DIR = join(import.meta.dirname, '../../../../packages/shared/src/messages');

describe('request config', () => {
  it('reads the language the proxy settled, and falls back to Vietnamese', async () => {
    stored.locale = 'en';
    await expect(resolveLocale()).resolves.toBe('en');
    stored.locale = 'fr';
    await expect(resolveLocale()).resolves.toBe('vi');
    stored.locale = undefined;
    await expect(resolveLocale()).resolves.toBe('vi');
  });

  it('hands the browser the web namespaces only, never the bot strings', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(webMessages(locale)).sort()).toEqual([...WEB_NAMESPACES].sort());
    }
    expect(webMessages('vi')).not.toHaveProperty('commands');
  });

  it('carries the business time zone for date formatting', async () => {
    const factory = requestConfig as unknown as () => Promise<{ timeZone: string; locale: string }>;
    stored.locale = 'en';
    await expect(factory()).resolves.toMatchObject({
      locale: 'en',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
  });

  it.each(SUPPORTED_LOCALES)(
    'translates every server error code in %s, from the real file',
    (locale) => {
      const file = JSON.parse(
        readFileSync(join(MESSAGES_DIR, locale, 'errors.json'), 'utf8'),
      ) as Record<string, unknown>;
      for (const code of ErrorCodeSchema.options) {
        expect(typeof file[code], `${locale} ${code}`).toBe('string');
        expect(MESSAGES[locale].errors[code]).toBe(file[code]);
      }
    },
  );

  it('has a catalog file in both languages for every namespace it serves', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const files = readdirSync(join(MESSAGES_DIR, locale));
      for (const namespace of WEB_NAMESPACES) expect(files).toContain(`${namespace}.json`);
    }
  });
});
