import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TEXT_CHANNEL_TYPES, useChannels } from './use-channels';

const GUILD = '1'.repeat(18);
const channel = {
  id: '2'.repeat(18),
  name: 'general',
  type: 0,
  parentId: null,
  position: 0,
};

describe('useChannels', () => {
  it('reads the channels route of the server and parses them', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify([channel]))));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChannels(GUILD));
    await waitFor(() => expect(result.current.data).toEqual([channel]));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/discord/channels`,
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('rejects a channel the shared schema does not describe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify([{ ...channel, id: 'nope' }])))),
    );
    const { result } = renderHook(() => useChannels(GUILD));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
  });

  it('offers text and announcement channels as the postable ones', () => {
    expect(TEXT_CHANNEL_TYPES).toEqual([0, 5]);
  });
});
