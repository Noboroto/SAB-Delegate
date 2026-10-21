import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { CHANNEL_TEXT, GUILD, MESSAGE, stubToolApi } from '@/lib/tools/test-support';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MentionNonReactorsForm } from './mention-non-reactors-form';
import { MentionReactorsForm } from './mention-reactors-form';

const LINK = `https://discord.com/channels/${GUILD}/${CHANNEL_TEXT}/${MESSAGE}`;
const USER = '8'.repeat(18);
const result = {
  dryRun: false,
  status: 'OK',
  count: 2,
  sample: [USER],
  chunks: ['<@' + USER + '> and one more'],
  delivered: false,
  postedChunks: 0,
};

beforeEach(() => {
  refresh.mockReset();
});

describe('MentionReactorsForm', () => {
  it('sends nothing until the message and emoji are filled in', async () => {
    const { calls } = stubToolApi({ 'mention/reactors': () => result });
    renderWithProviders(<MentionReactorsForm guildId={GUILD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lập danh sách' }));

    expect((await screen.findAllByText('Trường này là bắt buộc.')).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it('refuses text that is not a message link', async () => {
    const { calls } = stubToolApi({ 'mention/reactors': () => result });
    renderWithProviders(<MentionReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), 'hello');
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Lập danh sách' }));

    expect(await screen.findByText(/Dán liên kết tin nhắn/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('asks once for a double click and shows the list without posting it', async () => {
    const { calls } = stubToolApi({ 'mention/reactors': () => result });
    renderWithProviders(<MentionReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'ok');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Lập danh sách' }));

    expect(await screen.findByText('Đã liệt kê 2 thành viên.')).toBeInTheDocument();
    expect(screen.getByText(`<@${USER}> and one more`)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      channelId: CHANNEL_TEXT,
      messageId: MESSAGE,
      emoji: 'ok',
      locale: 'vi',
    });
    expect(calls[0]?.body).not.toHaveProperty('replyTo');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('previews the reply with the service plan and posts it only after confirming', async () => {
    const { calls } = stubToolApi({
      'mention/reactors': ({ body }) =>
        (body as { dryRun: boolean }).dryRun
          ? result
          : { ...result, delivered: true, postedChunks: 1 },
    });
    renderWithProviders(<MentionReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'ok');
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Đăng luôn danh sách dưới dạng trả lời tin nhắn này' }),
    );
    expect(screen.queryByRole('button', { name: 'Lập danh sách' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và đăng trả lời' }));

    expect(await screen.findByText(`<@${USER}> and one more`)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      dryRun: true,
      replyTo: { channelId: CHANNEL_TEXT, messageId: MESSAGE },
    });
    expect(refresh).not.toHaveBeenCalled();

    await userEvent.dblClick(await screen.findByRole('button', { name: 'Đăng trả lời' }));
    expect(await screen.findByText('Đã đăng 1 tin nhắn.')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ dryRun: false, replyTo: { messageId: MESSAGE } });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('marks the missing fields instead of opening a preview that cannot be made', async () => {
    const { calls } = stubToolApi({ 'mention/reactors': () => result });
    renderWithProviders(<MentionReactorsForm guildId={GUILD} />);
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Đăng luôn danh sách dưới dạng trả lời tin nhắn này' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Xem trước và đăng trả lời' }));

    expect((await screen.findAllByText('Trường này là bắt buộc.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Điền các trường bắt buộc để tiếp tục.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows a translated error, not the server text', async () => {
    stubToolApi();
    renderWithProviders(<MentionReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.type(screen.getByLabelText('Cảm xúc'), 'ok');
    await userEvent.click(screen.getByRole('button', { name: 'Lập danh sách' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Đã có lỗi xảy ra. Vui lòng thử lại sau.',
    );
  });
});

describe('MentionNonReactorsForm', () => {
  it('sends the message and the default scope', async () => {
    const { calls } = stubToolApi({
      'mention/non-reactors': () => ({
        ...result,
        status: 'ALL_REACTED',
        count: 0,
        sample: [],
        chunks: [],
      }),
    });
    renderWithProviders(<MentionNonReactorsForm guildId={GUILD} />);
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), LINK);
    await userEvent.click(screen.getByRole('button', { name: 'Lập danh sách' }));

    expect(await screen.findByText('Mọi người đều đã thả cảm xúc.')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      channelId: CHANNEL_TEXT,
      messageId: MESSAGE,
      onlyInChannel: true,
      includeBots: false,
      reply: false,
    });
  });

  it('never posts from Enter in the link field while replying is ticked', async () => {
    const { calls } = stubToolApi({ 'mention/non-reactors': () => result });
    renderWithProviders(<MentionNonReactorsForm guildId={GUILD} />);
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Đăng luôn danh sách dưới dạng trả lời tin nhắn này' }),
    );
    await userEvent.type(screen.getByLabelText('Liên kết tin nhắn'), `${LINK}{Enter}`);

    // Form validation is async: give a wrongly wired submit time to reach the API.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.filter((call) => (call.body as { dryRun: boolean }).dryRun === false)).toEqual([]);
  });
});
