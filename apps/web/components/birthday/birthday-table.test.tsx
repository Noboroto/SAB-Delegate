import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { BirthdayTable } from './birthday-table';

const GUILD = '1'.repeat(18);
const PERSON = { studentId: 'SE1', name: 'An', discordId: '2'.repeat(18), month: 3, day: 15 };

const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const urls = () => fetchMock.mock.calls.map(([url]) => url);

describe('BirthdayTable', () => {
  it.each(SUPPORTED_LOCALES)('lists the people in %s without bare keys', (locale) => {
    const { container } = renderWithProviders(
      <BirthdayTable guildId={GUILD} entries={[PERSON]} filtered={false} />,
      locale,
    );
    expect(container.textContent).not.toMatch(/web-birthday\./);
    expect(screen.getByText('An')).toBeVisible();
    expect(screen.getByText('15/3')).toBeVisible();
  });

  it('says the list is empty when nobody is on it', () => {
    renderWithProviders(<BirthdayTable guildId={GUILD} entries={[]} filtered={false} />);
    expect(screen.getByText('Chưa có ai trong danh sách.')).toBeVisible();
  });

  it('says the month is empty when a month filter is on', () => {
    renderWithProviders(<BirthdayTable guildId={GUILD} entries={[]} filtered />);
    expect(screen.getByText('Không có ai sinh nhật trong tháng này.')).toBeVisible();
  });

  it('removes only after the service has shown the plan and the person confirmed it', async () => {
    fetchMock.mockImplementation((url) =>
      answer(
        url.includes('dryRun=true')
          ? { dryRun: true, code: 'REMOVED_BY_STUDENT', count: 1, sample: [PERSON] }
          : { dryRun: false, code: 'REMOVED_BY_STUDENT', count: 1, sample: [] },
      ),
    );
    renderWithProviders(<BirthdayTable guildId={GUILD} entries={[PERSON]} filtered={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Xoá An' }));
    expect(await screen.findByText('Sẽ xoá 1 người:')).toBeInTheDocument();
    expect(urls()).toEqual([`/api/guilds/${GUILD}/birthdays?studentId=SE1&dryRun=true`]);
    expect(refresh).not.toHaveBeenCalled();

    await userEvent.dblClick(screen.getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(urls()).toEqual([
      `/api/guilds/${GUILD}/birthdays?studentId=SE1&dryRun=true`,
      `/api/guilds/${GUILD}/birthdays?studentId=SE1&confirm=true`,
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });

  it('keeps confirm off when the plan finds nobody', async () => {
    fetchMock.mockImplementation(() =>
      answer({ dryRun: true, code: 'NOT_FOUND', count: 0, sample: [] }),
    );
    renderWithProviders(<BirthdayTable guildId={GUILD} entries={[PERSON]} filtered={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Xoá An' }));
    expect(
      await screen.findByText('Không tìm thấy người này trong danh sách; có thể họ đã bị xoá.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
