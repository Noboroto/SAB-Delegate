import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TEXT_CHANNEL_TYPES } from '@/lib/discord/use-channels';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ChannelSelect } from './channel-select';

const GUILD = '1'.repeat(18);
const CATEGORY = '2'.repeat(18);
const GENERAL = '3'.repeat(18);
const LOUNGE = '4'.repeat(18);
const RULES = '5'.repeat(18);

const channels = [
  { id: RULES, name: 'rules', type: 0, parentId: null, position: 0 },
  { id: CATEGORY, name: 'Chat', type: 4, parentId: null, position: 1 },
  { id: GENERAL, name: 'general', type: 0, parentId: CATEGORY, position: 2 },
  { id: LOUNGE, name: 'Lounge', type: 2, parentId: CATEGORY, position: 3 },
];

function stubChannels(response: () => Response = () => new Response(JSON.stringify(channels))) {
  const fetchMock = vi.fn(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ChannelSelect', () => {
  it('lists the channels under their category and reports the pick', async () => {
    stubChannels();
    const onChange = vi.fn();
    renderWithProviders(<ChannelSelect guildId={GUILD} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('# general')).toBeInTheDocument();
    expect(screen.getByText('# rules')).toBeInTheDocument();
    expect(screen.getByText('Lounge')).toBeInTheDocument();
    expect(screen.getByText('Chat', { selector: '.ant-select-item-group' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('# general'));
    expect(onChange).toHaveBeenCalledWith(GENERAL);
  });

  it('offers only the requested channel types', async () => {
    stubChannels();
    renderWithProviders(<ChannelSelect guildId={GUILD} types={TEXT_CHANNEL_TYPES} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('# general')).toBeInTheDocument();
    expect(screen.queryByText('Lounge')).not.toBeInTheDocument();
  });

  it('reports a list of ids in multiple mode', async () => {
    stubChannels();
    const onChange = vi.fn();
    renderWithProviders(<ChannelSelect guildId={GUILD} multiple onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('# rules'));
    expect(onChange).toHaveBeenCalledWith([RULES]);
  });

  it('says the list could not be read and reads it again on retry', async () => {
    const fetchMock = stubChannels(
      () =>
        new Response(JSON.stringify({ code: 'GUILD_BOT_MISSING', message: 'x' }), { status: 404 }),
    );
    renderWithProviders(<ChannelSelect guildId={GUILD} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Không tải được danh sách.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
