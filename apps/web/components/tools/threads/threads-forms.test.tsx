import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { CHANNEL_TEXT, GUILD, pickOption, stubToolApi } from '@/lib/tools/test-support';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { CreateThreadForm } from './create-thread-form';
import { DeleteThreadsForm } from './delete-threads-form';
import { PrivateThreadsForm } from './private-threads-form';
import { RenameThreadsForm } from './rename-threads-form';

const THREAD_A = '8'.repeat(18);
const USER = '9'.repeat(18);

beforeEach(() => {
  refresh.mockReset();
});

describe('CreateThreadForm', () => {
  it('sends nothing until channel, name and message are filled in', async () => {
    const { calls } = stubToolApi({ threads: () => ({ status: 'CREATED', threadId: THREAD_A }) });
    renderWithProviders(<CreateThreadForm guildId={GUILD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mở thread' }));

    expect((await screen.findAllByText('Trường này là bắt buộc.')).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it('opens the thread once for a double click and shows its id', async () => {
    const { calls } = stubToolApi({ threads: () => ({ status: 'CREATED', threadId: THREAD_A }) });
    renderWithProviders(<CreateThreadForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tên thread'), 'Plan');
    await userEvent.type(screen.getByLabelText('Tin nhắn đầu tiên'), 'Hello');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Mở thread' }));

    expect(await screen.findByText(THREAD_A)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      channelId: CHANNEL_TEXT,
      name: 'Plan',
      message: 'Hello',
      isPrivate: false,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe('PrivateThreadsForm', () => {
  it('needs members or a role before it sends', async () => {
    const { calls } = stubToolApi({
      'threads/private': () => ({
        status: 'OK',
        linkProblem: null,
        total: 1,
        created: 1,
        failures: [],
      }),
    });
    renderWithProviders(<PrivateThreadsForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tiền tố tên'), 'ask');
    await userEvent.type(screen.getByLabelText('Tin nhắn đầu tiên'), 'Hi');
    await userEvent.click(screen.getByRole('button', { name: 'Mở các thread' }));

    expect(
      await screen.findByText('Hãy kiểm tra lại biểu mẫu: có trường còn thiếu hoặc chưa hợp lệ.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('opens threads for the ids pasted, wording the failures', async () => {
    const { calls } = stubToolApi({
      'threads/private': () => ({
        status: 'OK',
        linkProblem: null,
        total: 2,
        created: 1,
        failures: [{ userId: USER, reason: 'MEMBER_NOT_FOUND' }],
      }),
    });
    renderWithProviders(<PrivateThreadsForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tiền tố tên'), 'ask');
    await userEvent.type(screen.getByLabelText('Tin nhắn đầu tiên'), 'Hi');
    await userEvent.type(screen.getByLabelText('Id thành viên'), USER);
    await userEvent.click(screen.getByRole('button', { name: 'Mở các thread' }));

    expect(await screen.findByText('Đã mở 1 trên 2 thread.')).toBeInTheDocument();
    expect(screen.getByText(`${USER}: Không phải thành viên của máy chủ này.`)).toBeInTheDocument();
    expect(calls[0]?.body).toMatchObject({
      channelId: CHANNEL_TEXT,
      prefix: 'ask',
      userIds: [USER],
    });
  });
});

const batchPlan = {
  status: 'OK',
  count: 2,
  invalid: 0,
  sample: [
    { threadId: THREAD_A, name: 'old-a', newName: 'new-a' },
    { threadId: USER, name: 'old-b', newName: 'new-b' },
  ],
};

describe('RenameThreadsForm', () => {
  it('previews the rename with the service plan and confirms it once', async () => {
    const { calls } = stubToolApi({
      'threads/rename': ({ body }) =>
        (body as { dryRun: boolean }).dryRun
          ? batchPlan
          : { status: 'OK', count: 2, done: 2, failures: [] },
    });
    renderWithProviders(<RenameThreadsForm guildId={GUILD} />);
    const trigger = screen.getByRole('button', { name: 'Xem trước và đổi tên' });
    expect(trigger).toBeDisabled();

    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tiền tố hiện tại'), 'old');
    await userEvent.type(screen.getByLabelText('Tiền tố mới'), 'new');
    await userEvent.click(trigger);

    expect(await screen.findByText('Có 2 thread đang hoạt động khớp.')).toBeInTheDocument();
    expect(screen.getByText('old-a thành new-a')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      oldPrefix: 'old',
      newPrefix: 'new',
      dryRun: true,
      confirm: false,
    });

    await userEvent.dblClick(await screen.findByRole('button', { name: 'Đổi tên' }));
    expect(await screen.findByText('Đã xong cho 2 trên 2 thread.')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ dryRun: false, confirm: true });
  });
});

describe('DeleteThreadsForm', () => {
  it('deletes nothing when the plan is cancelled', async () => {
    const { calls } = stubToolApi({
      'threads/delete': () => ({ ...batchPlan, sample: [{ threadId: THREAD_A, name: 'old-a' }] }),
    });
    renderWithProviders(<DeleteThreadsForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tiền tố'), 'old');
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và xoá' }));

    expect(await screen.findByText('old-a')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ dryRun: true, confirm: false });
  });

  it('cannot confirm when nothing matches', async () => {
    stubToolApi({ 'threads/delete': () => ({ status: 'OK', count: 0, invalid: 0, sample: [] }) });
    renderWithProviders(<DeleteThreadsForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.type(screen.getByLabelText('Tiền tố'), 'old');
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và xoá' }));

    expect(
      await screen.findByText('Không có thread đang hoạt động nào khớp. Sẽ không có gì thay đổi.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Xoá các thread' })).toBeDisabled();
  });
});
