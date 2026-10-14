import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import {
  CHANNEL_TEXT,
  GUILD,
  MESSAGE,
  pickOption,
  ROLE_MOD,
  stubToolApi,
} from '@/lib/tools/test-support';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { IntroductionForm } from './introduction-form';
import { InviteForm } from './invite-form';
import { ReactorsForm } from './reactors-form';
import { RoleMembersForm } from './role-members-form';

const USER_A = '8'.repeat(18);
const USER_B = '9'.repeat(18);
const LINK = `https://discord.com/channels/${GUILD}/${CHANNEL_TEXT}/${MESSAGE}`;

beforeEach(() => {
  refresh.mockReset();
});

describe('ReactorsForm', () => {
  it('asks with the message and emoji in the query and lists the ids one per line', async () => {
    const { calls } = stubToolApi({
      'info/reactors': () => ({ url: LINK, emoji: 'ok', userIds: [USER_A, USER_B] }),
    });
    renderWithProviders(<ReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'ok');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Liệt kê id' }));

    expect(await screen.findByText('Thành viên (2)')).toBeInTheDocument();
    // One id per line in the page; the text matcher folds the line break to a space.
    expect(screen.getByText(`${USER_A} ${USER_B}`)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      query: { channelId: CHANNEL_TEXT, messageId: MESSAGE, emoji: 'ok' },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says so when nobody reacted', async () => {
    stubToolApi({ 'info/reactors': () => ({ url: LINK, emoji: 'ok', userIds: [] }) });
    renderWithProviders(<ReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'ok');
    await userEvent.click(screen.getByRole('button', { name: 'Liệt kê id' }));

    expect(await screen.findByText('Không có.')).toBeInTheDocument();
  });
});

describe('RoleMembersForm', () => {
  it('sends only the role when no channel is chosen', async () => {
    const { calls } = stubToolApi({
      'info/role-members': () => ({ roleId: ROLE_MOD, roleName: 'Moderator', userIds: [USER_A] }),
    });
    renderWithProviders(<RoleMembersForm guildId={GUILD} />);
    await pickOption('Vai trò', 'Moderator');
    await userEvent.click(screen.getByRole('button', { name: 'Liệt kê id' }));

    expect(await screen.findByText('Vai trò: Moderator')).toBeInTheDocument();
    expect(calls[0]?.query).toEqual({ roleId: ROLE_MOD });
  });
});

describe('InviteForm', () => {
  it('creates the invite once and shows its link', async () => {
    const { calls } = stubToolApi({
      'info/invite': () => ({
        url: 'https://discord.gg/abc',
        channelId: CHANNEL_TEXT,
        channelName: 'general',
      }),
    });
    renderWithProviders(<InviteForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Tạo liên kết mời' }));

    expect(await screen.findByText('https://discord.gg/abc')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ channelId: CHANNEL_TEXT });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe('IntroductionForm', () => {
  it('asks for a member before it looks anything up', async () => {
    const { calls } = stubToolApi({ 'info/introduction': () => ({ status: 'NO_CHANNEL' }) });
    renderWithProviders(<IntroductionForm guildId={GUILD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }));

    expect((await screen.findAllByText('Trường này là bắt buộc.')).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });
});
