import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/servers/1/modules/birthday',
}));

import { BirthdayPage } from './birthday-page';

const GUILD = '1'.repeat(18);
const PERSON = { studentId: 'SE1', name: 'An', discordId: '2'.repeat(18), month: 3, day: 15 };

beforeEach(() => {
  nav.refresh.mockReset();
  nav.push.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('[]'))),
  );
});

describe('BirthdayPage', () => {
  it.each(SUPPORTED_LOCALES)('has a title and the list in %s without bare keys', (locale) => {
    const { container } = renderWithProviders(
      <BirthdayPage guildId={GUILD} entries={[PERSON]} month={undefined} />,
      locale,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: locale === 'vi' ? 'Sinh nhật' : 'Birthdays' }),
    ).toBeVisible();
    expect(screen.getByText('An')).toBeVisible();
    expect(container.textContent).not.toMatch(/web-birthday\./);
  });

  it('shows the month the server filtered by', () => {
    renderWithProviders(<BirthdayPage guildId={GUILD} entries={[PERSON]} month={3} />);
    expect(screen.getByText('Tháng 3')).toBeVisible();
  });

  it('asks the server for a month through the URL instead of filtering the list itself', async () => {
    renderWithProviders(<BirthdayPage guildId={GUILD} entries={[PERSON]} month={undefined} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc theo tháng' }));
    await userEvent.click(await screen.findByText('Tháng 2'));
    expect(nav.push).toHaveBeenCalledWith('/servers/1/modules/birthday?month=2');
    expect(screen.getByText('An')).toBeVisible();
  });
});
