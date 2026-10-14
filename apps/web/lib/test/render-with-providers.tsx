import { render } from '@testing-library/react';
import { App } from 'antd';
import { NextIntlClientProvider } from 'next-intl';
import { webMessages } from '@/lib/web-messages';
import type { SupportedLocale } from '@/lib/locale';

/**
 * Renders under the real provider stack the app uses: next-intl with the real
 * catalog (not a `t()` that echoes keys, which proves nothing about the
 * translation) and AntD's `<App>` for `App.useApp()`.
 */
export function renderWithProviders(ui: React.ReactElement, locale: SupportedLocale = 'vi') {
  return render(
    <NextIntlClientProvider locale={locale} messages={webMessages(locale)}>
      <App>{ui}</App>
    </NextIntlClientProvider>,
  );
}
