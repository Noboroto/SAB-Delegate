import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILD_SECTIONS, guildSectionPath } from '@/lib/guild-sections';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ServerOverview } from './server-overview';

const GUILD = '1'.repeat(18);
const HOUR = 3_600_000;

beforeEach(() => {
  refresh.mockReset();
});

// Written out per language on purpose: the expectation must not come from the
// catalog it checks.
const TEXT = {
  vi: {
    online: 'Đang chạy',
    twoDays: '2 ngày 2 giờ 5 phút',
    ping: '42 ms',
    pingUnknown: 'Chưa có số đo',
    lessThanMinute: 'Dưới 1 phút',
    shortcuts: 'Đi tới',
    unavailable: 'Chưa đọc được tình trạng bot',
    retry: 'Thử lại',
  },
  en: {
    online: 'Running',
    twoDays: '2 d 2 h 5 min',
    ping: '42 ms',
    pingUnknown: 'Not measured yet',
    lessThanMinute: 'Under 1 minute',
    shortcuts: 'Go to',
    unavailable: 'Could not read the bot status',
    retry: 'Try again',
  },
} as const;

describe.each(SUPPORTED_LOCALES)('ServerOverview (%s)', (locale) => {
  const text = TEXT[locale];

  it('names the server as the page heading and shows the bot status', () => {
    renderWithProviders(
      <ServerOverview
        guildId={GUILD}
        guildName="Alpha"
        overview={{ uptimeMs: 50 * HOUR + 5 * 60_000, wsPing: 42 }}
      />,
      locale,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText(text.online)).toBeInTheDocument();
    expect(screen.getByText(text.twoDays)).toBeInTheDocument();
    expect(screen.getByText(text.ping)).toBeInTheDocument();
  });

  it('says so when no latency has been measured yet', () => {
    renderWithProviders(
      <ServerOverview
        guildId={GUILD}
        guildName="Alpha"
        overview={{ uptimeMs: 1000, wsPing: -1 }}
      />,
      locale,
    );
    expect(screen.getByText(text.pingUnknown)).toBeInTheDocument();
    expect(screen.getByText(text.lessThanMinute)).toBeInTheDocument();
  });

  it('links every section of the server', () => {
    renderWithProviders(
      <ServerOverview guildId={GUILD} guildName="Alpha" overview={{ uptimeMs: 1000, wsPing: 1 }} />,
      locale,
    );
    const shortcuts = screen.getByRole('region', { name: text.shortcuts });
    const hrefs = within(shortcuts)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(
      GUILD_SECTIONS.map((section) => `/servers/${GUILD}/${guildSectionPath(section)}`),
    );
  });

  it('keeps the title and the links when the bot status cannot be read, and reloads on retry', async () => {
    renderWithProviders(
      <ServerOverview guildId={GUILD} guildName="Alpha" overview={undefined} />,
      locale,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: text.unavailable })).toBeInTheDocument();
    expect(screen.queryByText(text.online)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: text.shortcuts })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: text.retry }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
