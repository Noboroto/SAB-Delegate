import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildSettings } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ServerSettings } from './server-settings';

const GUILD = '1'.repeat(18);
const SETTINGS: GuildSettings = {
  introChannelId: null,
  logChannelId: null,
  birthdayChannelId: null,
  activityCategoryId: null,
  wordChannelId: null,
  wordMaxWords: 1500,
  locale: 'vi',
};

// Written out per language on purpose: the expectation must not come from the
// catalog it checks.
const TEXT = {
  vi: {
    title: 'Cài đặt',
    language: 'Ngôn ngữ của bot',
    channels: 'Kênh',
    profile: 'Tên và ảnh của bot',
    unavailable: 'Chưa đọc được tên và ảnh của bot. Hãy thử lại sau ít phút.',
  },
  en: {
    title: 'Settings',
    language: 'Bot language',
    channels: 'Channels',
    profile: 'Bot name and picture',
    unavailable: "The bot's name and picture cannot be read right now. Try again in a moment.",
  },
} as const;

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('[]'))),
  );
});

describe.each(SUPPORTED_LOCALES)('ServerSettings (%s)', (locale) => {
  it('shows every section in the language, without a bare key', () => {
    renderWithProviders(
      <ServerSettings
        guildId={GUILD}
        guildName="Nhà SAB"
        settings={SETTINGS}
        botProfile={{ nick: null, avatarUrl: null }}
      />,
      locale,
    );
    expect(screen.getByRole('heading', { level: 1, name: TEXT[locale].title })).toBeInTheDocument();
    expect(screen.getByText(TEXT[locale].language)).toBeInTheDocument();
    expect(screen.getByText(TEXT[locale].channels)).toBeInTheDocument();
    expect(screen.getByText(TEXT[locale].profile)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/web-settings|botProfile\.|channels\./);
  });

  it('says the bot look cannot be read and keeps the settings usable', () => {
    renderWithProviders(
      <ServerSettings
        guildId={GUILD}
        guildName="Nhà SAB"
        settings={SETTINGS}
        botProfile={undefined}
      />,
      locale,
    );
    expect(screen.getByText(TEXT[locale].unavailable)).toBeInTheDocument();
    expect(screen.getByText(TEXT[locale].channels)).toBeInTheDocument();
  });
});
