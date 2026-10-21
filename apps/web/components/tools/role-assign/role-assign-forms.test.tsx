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

import { RoleAssignMembersForm } from './role-assign-members-form';
import { RoleAssignReactorsForm } from './role-assign-reactors-form';

const USER_A = '8'.repeat(18);
const USER_B = '9'.repeat(18);
const LINK = `https://discord.com/channels/${GUILD}/${CHANNEL_TEXT}/${MESSAGE}`;

const plan = {
  dryRun: true,
  status: 'OK',
  planned: 2,
  done: 0,
  skipped: 1,
  sample: [USER_A, USER_B],
  failures: [],
};
const ran = {
  dryRun: false,
  status: 'OK',
  planned: 2,
  done: 1,
  skipped: 1,
  sample: [],
  failures: [{ userId: USER_B, name: 'binh', reason: 'Missing Permissions' }],
};

beforeEach(() => {
  refresh.mockReset();
});

async function fillMembers() {
  await pickOption('Vai trò', 'Moderator');
  await userEvent.type(screen.getByLabelText('Id thành viên'), `${USER_A} <@${USER_B}>`);
}

describe('RoleAssignMembersForm', () => {
  it('marks what is missing when clicked early, and asks nothing until the form is valid', async () => {
    const { calls } = stubToolApi({ 'role-assign/members': () => plan });
    renderWithProviders(<RoleAssignMembersForm guildId={GUILD} />);
    const button = screen.getByRole('button', { name: 'Xem trước và cho vai trò' });
    expect(button).toBeEnabled();
    await userEvent.click(button);

    expect((await screen.findAllByText('Trường này là bắt buộc.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Dán id thành viên hoặc chọn một vai trò.')).toBeInTheDocument();
    expect(screen.getByText('Điền các trường bắt buộc để tiếp tục.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await fillMembers();
    expect(screen.queryByText('Điền các trường bắt buộc để tiếp tục.')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('draws giving a role as a plain action and taking it away as a destructive one', async () => {
    stubToolApi({ 'role-assign/members': () => plan });
    renderWithProviders(<RoleAssignMembersForm guildId={GUILD} />);
    await fillMembers();
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và cho vai trò' }));
    expect(await screen.findByRole('button', { name: 'Cho vai trò' })).not.toHaveClass(
      'ant-btn-dangerous',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    await userEvent.click(screen.getByText('Gỡ vai trò'));
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và gỡ vai trò' }));
    expect(await screen.findByRole('button', { name: 'Gỡ vai trò' })).toHaveClass(
      'ant-btn-dangerous',
    );
  });

  it('shows the service plan first and only confirm makes the real call', async () => {
    const { calls } = stubToolApi({
      'role-assign/members': ({ body }) => ((body as { dryRun: boolean }).dryRun ? plan : ran),
    });
    renderWithProviders(<RoleAssignMembersForm guildId={GUILD} />);
    await fillMembers();
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và cho vai trò' }));

    expect(await screen.findByText('Vai trò sẽ được cho 2 thành viên.')).toBeInTheDocument();
    expect(
      screen.getByText('1 id không phải thành viên của máy chủ này và bị bỏ qua.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      roleId: ROLE_MOD,
      userIds: [USER_A, USER_B],
      remove: false,
      dryRun: true,
      confirm: false,
    });

    await userEvent.dblClick(await screen.findByRole('button', { name: 'Cho vai trò' }));
    expect(await screen.findByText('Đã xong cho 1 trên 2 thành viên.')).toBeInTheDocument();
    expect(screen.getByText('binh (' + USER_B + '): Missing Permissions')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({
      dryRun: false,
      confirm: true,
      userIds: [USER_A, USER_B],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('runs nothing when the person cancels the plan', async () => {
    const { calls } = stubToolApi({ 'role-assign/members': () => plan });
    renderWithProviders(<RoleAssignMembersForm guildId={GUILD} />);
    await fillMembers();
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và cho vai trò' }));
    await screen.findByText('Vai trò sẽ được cho 2 thành viên.');
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('RoleAssignReactorsForm', () => {
  it('cannot confirm a plan with nobody in it', async () => {
    stubToolApi({
      'role-assign/reactors': () => ({
        ...plan,
        status: 'NO_REACTORS',
        planned: 0,
        sample: [],
        skipped: 0,
      }),
    });
    renderWithProviders(<RoleAssignReactorsForm guildId={GUILD} />);
    await pickOption('Vai trò', 'Moderator');
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'ok');
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và cho vai trò' }));

    expect(
      await screen.findByText('Không ai thả cảm xúc đó nên không có gì để làm.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Cho vai trò' })).toBeDisabled();
  });
});
