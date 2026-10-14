import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import {
  CHANNEL_TEXT,
  CHANNEL_VOICE,
  GUILD,
  MESSAGE,
  pickOption,
  stubToolApi,
} from '@/lib/tools/test-support';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { PurgeForm } from './purge-form';

const NEWEST = '9'.repeat(18);
const plan = {
  status: 'OK',
  count: 10,
  fromMessageId: NEWEST,
  olderCount: 3,
  sample: [NEWEST],
};

beforeEach(() => {
  refresh.mockReset();
});

function purgeApi(preview: unknown = plan) {
  return stubToolApi({
    purge: ({ body }) =>
      (body as { dryRun: boolean }).dryRun
        ? preview
        : { status: 'OK', count: 10, deleted: 9, failed: 1 },
  });
}

describe('PurgeForm', () => {
  it('keeps the button off until a channel is chosen and names the scope', async () => {
    purgeApi();
    renderWithProviders(<PurgeForm guildId={GUILD} />);
    const trigger = await screen.findByRole('button', { name: 'Xem trước và xoá 10 tin nhắn' });
    expect(trigger).toBeDisabled();

    await pickOption('Kênh', '# general');
    expect(trigger).toBeEnabled();
  });

  it('shows the service plan, and the real call happens only after confirm, pinned to the plan', async () => {
    const { calls } = purgeApi();
    renderWithProviders(<PurgeForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Xem trước và xoá 10 tin nhắn' }),
    );

    expect(await screen.findByText('Sẽ xoá 10 tin nhắn.')).toBeInTheDocument();
    expect(
      screen.getByText('3 tin trong số đó cũ hơn hai tuần và bị xoá từng tin một nên lâu hơn.'),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      mode: 'last',
      channelId: CHANNEL_TEXT,
      count: 10,
      dryRun: true,
      confirm: false,
    });
    expect(calls[0]?.body).not.toHaveProperty('fromMessageId');

    await userEvent.dblClick(await screen.findByRole('button', { name: 'Xoá các tin nhắn' }));
    expect(await screen.findByText('Đã xoá 9 trên 10 tin nhắn.')).toBeInTheDocument();
    expect(screen.getByText('Không xoá được 1 tin nhắn.')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ dryRun: false, confirm: true, fromMessageId: NEWEST });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('deletes nothing when the person cancels', async () => {
    const { calls } = purgeApi();
    renderWithProviders(<PurgeForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Xem trước và xoá 10 tin nhắn' }),
    );
    await screen.findByText('Sẽ xoá 10 tin nhắn.');
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cannot confirm a refused range', async () => {
    purgeApi({ ...plan, status: 'RANGE_TOO_LARGE', count: 0, fromMessageId: null, sample: [] });
    renderWithProviders(<PurgeForm guildId={GUILD} />);
    await pickOption('Kênh', '# general');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Xem trước và xoá 10 tin nhắn' }),
    );

    expect(
      await screen.findByText('Khoảng này chứa quá nhiều tin nhắn. Hãy chọn khoảng nhỏ hơn.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Xoá các tin nhắn' })).toBeDisabled();
  });

  it('refuses a range whose first message is in another channel', async () => {
    const { calls } = purgeApi();
    renderWithProviders(<PurgeForm guildId={GUILD} />);
    await userEvent.click(screen.getByText('Tin nhắn nằm giữa hai tin'));
    await pickOption('Kênh', '# general');
    const trigger = screen.getByRole('button', { name: 'Xem trước và xoá khoảng tin nhắn' });
    const field = screen.getByLabelText('Xoá các tin nhắn mới hơn');

    await userEvent.type(
      field,
      `https://discord.com/channels/${GUILD}/${CHANNEL_VOICE}/${MESSAGE}`,
    );
    await userEvent.tab();
    expect(
      await screen.findByText('Dán liên kết hoặc id của một tin nhắn trong kênh ở trên.'),
    ).toBeInTheDocument();
    expect(trigger).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, MESSAGE);
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(calls).toHaveLength(0);
  });
});
