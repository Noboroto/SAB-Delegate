import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ThemeProvider } from '@/components/ui/theme-provider';
import { siteUrl } from '@/lib/site-url';
import {
  THEME_MODE_COOKIE,
  THEME_RESOLVED_COOKIE,
  parseResolvedTheme,
  parseThemeMode,
} from '@/lib/theme';
import './globals.css';

// Self-hosted, the only font source: a build-time dependency on Google would add
// nothing the two faces below do not cover.
const beVietnamPro = localFont({
  src: [
    { path: './fonts/be-vietnam-pro-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/be-vietnam-pro-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-be-vietnam-pro',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web');
  const locale = await getLocale();
  const site = siteUrl();
  return {
    // Turns the `opengraph-image.png` beside this file into an absolute URL.
    metadataBase: site,
    title: { default: t('appName'), template: `%s | ${t('appName')}` },
    description: t('siteDescription'),
    openGraph: {
      title: t('appName'),
      description: t('siteDescription'),
      type: 'website',
      siteName: t('appName'),
      locale: locale === 'en' ? 'en_US' : 'vi_VN',
      // `metadataBase` does not fill `og:url`, and some scrapers open it from the
      // card. The fixed origin keeps tracking parameters off the preview.
      url: site,
    },
    // The card shape only: Next copies title and description from `openGraph`.
    // A page must not declare its own `twitter`, which replaces this one whole.
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = { viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, t, cookieStore] = await Promise.all([
    getLocale(),
    getMessages(),
    getTranslations('web'),
    cookies(),
  ]);
  const resolved = parseResolvedTheme(cookieStore.get(THEME_RESOLVED_COOKIE)?.value);
  const mode = parseThemeMode(cookieStore.get(THEME_MODE_COOKIE)?.value);

  return (
    // The provider rewrites `data-theme` right after mount when the system
    // preference differs from the cookie.
    <html
      lang={locale}
      data-theme={resolved}
      className={beVietnamPro.variable}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider messages={messages}>
          <a className="skip-link" href="#main">
            {t('skipToContent')}
          </a>
          <ThemeProvider initialMode={mode} initialResolved={resolved}>
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
