import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { MemberSelect } from './member-select';

const GUILD = '1'.repeat(18);
const ALICE = '2'.repeat(18);

const found = [
  { id: ALICE, username: 'alice', displayName: 'Alice N.', bot: false },
  { id: '3'.repeat(18), username: 'alibot', displayName: 'Ali Bot', bot: true },
];

describe('MemberSelect', () => {
  it('asks Discord through the server only once something is typed', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(found))));
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    renderWithProviders(<MemberSelect guildId={GUILD} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Gõ tên hoặc biệt danh để tìm thành viên.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByRole('combobox'), 'ali');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/discord/members?q=ali`,
      expect.objectContaining({ method: 'GET' }),
    );

    // The server matched by nickname or username; the picker must not filter again.
    expect(await screen.findByText('Alice N. (@alice)')).toBeInTheDocument();
    expect(screen.getByText('Ali Bot (@alibot) · bot')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Alice N. (@alice)'));
    expect(onChange).toHaveBeenCalledWith(ALICE);
  });
});
