import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommandCatalogEntry } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CommandCatalog } from './command-catalog';

const commands: CommandCatalogEntry[] = [
  {
    name: 'poll',
    description: 'Make a poll <b>x</b>',
    defaultMemberPermissions: null,
    guildOnly: true,
    subcommands: [],
  },
  {
    name: 'birthday',
    description: 'Birthdays',
    defaultMemberPermissions: '8192',
    guildOnly: false,
    subcommands: [{ name: 'remove', description: 'Remove one' }],
  },
];

const TEXT = {
  vi: {
    title: 'Lệnh',
    everyone: 'Ai cũng dùng được',
    restricted: 'Cần quyền trong máy chủ',
    guildOnly: 'Chỉ trong máy chủ',
    empty: 'Chưa có lệnh nào',
  },
  en: {
    title: 'Commands',
    everyone: 'Anyone can use',
    restricted: 'Needs a server permission',
    guildOnly: 'Server only',
    empty: 'No commands yet',
  },
} as const;

describe.each(SUPPORTED_LOCALES)('CommandCatalog (%s)', (locale) => {
  const text = TEXT[locale];

  it('groups the commands and lists their subcommands as plain text', () => {
    renderWithProviders(<CommandCatalog commands={commands} />, locale);
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeInTheDocument();
    const everyone = screen.getByRole('region', { name: text.everyone });
    expect(within(everyone).getByText('/poll')).toBeInTheDocument();
    expect(within(everyone).getByText('Make a poll <b>x</b>')).toBeInTheDocument();
    expect(within(everyone).getByText(text.guildOnly)).toBeInTheDocument();
    const restricted = screen.getByRole('region', { name: text.restricted });
    expect(within(restricted).getByText('/birthday remove')).toBeInTheDocument();
    expect(within(restricted).getByText('Remove one')).toBeInTheDocument();
  });

  it('says so when there is no command', () => {
    renderWithProviders(<CommandCatalog commands={[]} />, locale);
    expect(screen.getByRole('heading', { level: 2, name: text.empty })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
