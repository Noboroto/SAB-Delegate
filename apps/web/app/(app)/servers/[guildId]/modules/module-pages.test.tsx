import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: async (path: string, { parser }: { parser: { parse(x: unknown): unknown } }) =>
    parser.parse(await api.fetch(path)),
}));
vi.mock('next-intl/server', async () => {
  const { serverTranslations } = await import('@/lib/test/server-translations');
  const translate = serverTranslations();
  return { getTranslations: (namespace: string) => translate(namespace) };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/servers/1/modules/birthday',
}));
vi.mock('@/components/forms/member-select', () => ({ MemberSelect: () => <input /> }));

import BirthdayModulePage, { generateMetadata as birthdayMetadata } from './birthday/page';
import NoteModulePage, { generateMetadata as noteMetadata } from './note/page';

const GUILD = '1'.repeat(18);
const params = Promise.resolve({ guildId: GUILD });

beforeEach(() => {
  api.fetch.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('[]'))),
  );
});

describe('birthday route', () => {
  it('titles the tab and reads the month from the URL for the server to filter', async () => {
    api.fetch.mockResolvedValue([
      { studentId: 'SE1', name: 'An', discordId: '2'.repeat(18), month: 3, day: 15 },
    ]);
    expect(await birthdayMetadata()).toEqual({ title: 'Sinh nhật' });

    renderWithProviders(
      await BirthdayModulePage({ params, searchParams: Promise.resolve({ month: '3' }) }),
    );
    expect(api.fetch).toHaveBeenCalledWith(`/api/guilds/${GUILD}/birthdays?month=3`);
    // The wishes belong to the other tab and are not read for this one.
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Sinh nhật' })).toBeVisible();
    expect(screen.getByText('An')).toBeVisible();
  });

  it('reads only the wishes for the wishes tab', async () => {
    api.fetch.mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111', text: 'Chúc ${name}', used: false },
    ]);
    renderWithProviders(
      await BirthdayModulePage({ params, searchParams: Promise.resolve({ tab: 'wishes' }) }),
    );
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(api.fetch).toHaveBeenCalledWith(`/api/guilds/${GUILD}/birthday-wishes`);
    expect(screen.getByRole('button', { name: 'Thêm lời chúc' })).toBeVisible();
  });

  it('ignores a month that is not a month', async () => {
    api.fetch.mockResolvedValue([]);
    renderWithProviders(
      await BirthdayModulePage({ params, searchParams: Promise.resolve({ month: '99' }) }),
    );
    expect(api.fetch).toHaveBeenCalledWith(`/api/guilds/${GUILD}/birthdays`);
  });
});

describe('note route', () => {
  it('titles the tab and lists the notes the server returned, reading the date from JSON text', async () => {
    api.fetch.mockResolvedValue([
      {
        roleId: '2'.repeat(18),
        topic: 'Rules',
        content: 'Be kind',
        updatedAt: '2026-10-14T05:00:00.000Z',
      },
    ]);
    expect(await noteMetadata()).toEqual({ title: 'Ghi chú' });

    renderWithProviders(await NoteModulePage({ params }));
    expect(api.fetch).toHaveBeenCalledWith(`/api/guilds/${GUILD}/notes`);
    expect(screen.getByRole('heading', { level: 1, name: 'Ghi chú' })).toBeVisible();
    expect(screen.getByText('Be kind')).toBeVisible();
  });
});
