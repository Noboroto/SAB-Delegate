import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatbotQuotaRow } from '@sab/shared';
import { GUILD } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ChatbotQuotaPicker } from './chatbot-quota-picker';

const OTHER = '8'.repeat(18);
const OWN: ChatbotQuotaRow = {
  userId: OTHER,
  displayName: 'Bình',
  used: 10,
  limit: 300_000,
  bonus: 0,
  overridden: true,
  remaining: 299_990,
};

function stubQuota(items: ChatbotQuotaRow[]) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          items,
          pagination: { page: 1, pageSize: 1, total: items.length },
          period: '2026-10',
          defaultLimit: 100_000,
        }),
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ChatbotQuotaPicker', () => {
  it('reads the row of a member who is not on the page before it offers anything', async () => {
    const fetchMock = stubQuota([OWN]);
    const onOpen = vi.fn();
    renderWithProviders(
      <ChatbotQuotaPicker guildId={GUILD} userId={OTHER} pageRow={undefined} onOpen={onOpen} />,
    );
    const setLimit = screen.getByRole('button', { name: 'Đặt hạn mức' });
    expect(setLimit).toBeDisabled();

    await waitFor(() => expect(setLimit).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/chatbot/quota?page=1&pageSize=1&q=${OTHER}`,
      expect.anything(),
    );
    await userEvent.click(setLimit);
    expect(onOpen).toHaveBeenCalledWith('limit', OWN);
  });

  it('passes no row for a member with no usage and no limit of their own', async () => {
    stubQuota([]);
    const onOpen = vi.fn();
    renderWithProviders(
      <ChatbotQuotaPicker guildId={GUILD} userId={OTHER} pageRow={undefined} onOpen={onOpen} />,
    );
    const grant = screen.getByRole('button', { name: 'Thêm token' });
    await waitFor(() => expect(grant).toBeEnabled());
    await userEvent.click(grant);
    expect(onOpen).toHaveBeenCalledWith('grant', undefined);
  });

  it('uses the row of the page and reads nothing when the member is on it', async () => {
    const fetchMock = stubQuota([]);
    const onOpen = vi.fn();
    renderWithProviders(
      <ChatbotQuotaPicker guildId={GUILD} userId={OTHER} pageRow={OWN} onOpen={onOpen} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Đặt hạn mức' }));
    expect(onOpen).toHaveBeenCalledWith('limit', OWN);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
