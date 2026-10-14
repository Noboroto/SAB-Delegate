import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { CHANNEL_VOICE, GUILD, pickOption, ROLE_MOD, stubToolApi } from '@/lib/tools/test-support';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AttendanceForm } from './attendance-form';

const HERE = '8'.repeat(18);
const AWAY = '9'.repeat(18);

describe('AttendanceForm', () => {
  it('sends nothing until a role and a voice channel are chosen', async () => {
    const { calls } = stubToolApi({ attendance: () => ({}) });
    renderWithProviders(<AttendanceForm guildId={GUILD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));

    expect((await screen.findAllByText('Trường này là bắt buộc.')).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it('asks with the role and channel in the query and lists who is where', async () => {
    const { calls } = stubToolApi({
      attendance: () => ({
        roleId: ROLE_MOD,
        roleName: 'Moderator',
        voiceChannelId: CHANNEL_VOICE,
        total: 2,
        present: [{ userId: HERE, username: 'linh' }],
        absent: [{ userId: AWAY, username: 'binh' }],
      }),
    });
    renderWithProviders(<AttendanceForm guildId={GUILD} />);
    await pickOption('Vai trò', 'Moderator');
    await pickOption('Kênh thoại', 'Voice room');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Kiểm tra' }));

    expect(
      await screen.findByText('Moderator: 1 trên 2 thành viên đang ở trong kênh.'),
    ).toBeInTheDocument();
    expect(screen.getByText(`linh (${HERE})`)).toBeInTheDocument();
    expect(screen.getByText(`binh (${AWAY})`)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      query: { roleId: ROLE_MOD, voiceChannelId: CHANNEL_VOICE },
    });
  });
});
