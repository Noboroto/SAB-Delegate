import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { GUILD, stubToolApi } from '@/lib/tools/test-support';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ActivityForm } from './activity-form';

const ids = {
  categoryId: '1'.repeat(18),
  roles: { event: '2'.repeat(18), multi: '3'.repeat(18), mc: '4'.repeat(18) },
  channels: { general: '5'.repeat(18), threadOnly: '6'.repeat(18), voice: '7'.repeat(18) },
};

beforeEach(() => {
  refresh.mockReset();
});

describe('ActivityForm', () => {
  it('refuses a short name that is not exactly three characters', async () => {
    const { calls } = stubToolApi({ activity: () => ids });
    renderWithProviders(<ActivityForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Biểu tượng cảm xúc'), 'x');
    await userEvent.type(screen.getByLabelText('Tên'), 'Chess');
    await userEvent.type(screen.getByLabelText('Tên viết tắt'), 'ch');
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và tạo hoạt động' }));

    expect((await screen.findAllByText('Đúng 3 ký tự.')).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it('previews the roles and channels, then creates the activity once and lists what was made', async () => {
    const { calls } = stubToolApi({ activity: () => ids });
    renderWithProviders(<ActivityForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Biểu tượng cảm xúc'), 'x');
    await userEvent.type(screen.getByLabelText('Tên'), 'Chess Club');
    await userEvent.type(screen.getByLabelText('Tên viết tắt'), 'chs');
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và tạo hoạt động' }));

    expect(await screen.findByText('Chess Club-Event')).toBeInTheDocument();
    expect(screen.getByText('x┃chess-club-thread-only')).toBeInTheDocument();
    expect(screen.getByText('x┃Chess Club voice')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Tạo hoạt động' }));
    expect(await screen.findByText('Đã tạo')).toBeInTheDocument();
    expect(screen.getByText(ids.channels.voice)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ emoji: 'x', name: 'Chess Club', shortName: 'chs' });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
