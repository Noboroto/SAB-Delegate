import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemOverviewSchema } from '@sab/shared';
import { ApiRequestError } from '@/lib/api/api-response';

const server = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api/server-fetch', () => ({ serverFetch: server.fetch }));

import { getOverview } from './get-overview';

const GUILD = '1'.repeat(18);

beforeEach(() => {
  server.fetch.mockReset();
});

describe('getOverview', () => {
  it('reads the overview route of the server', async () => {
    server.fetch.mockResolvedValue({ uptimeMs: 5, wsPing: 9 });
    await expect(getOverview(GUILD)).resolves.toEqual({
      ok: true,
      overview: { uptimeMs: 5, wsPing: 9 },
    });
    expect(server.fetch).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/overview`,
      expect.objectContaining({ parser: SystemOverviewSchema }),
    );
  });

  it('turns a server that cannot answer into a result the page can show', async () => {
    server.fetch.mockRejectedValue(new ApiRequestError(503));
    await expect(getOverview(GUILD)).resolves.toEqual({ ok: false });
    server.fetch.mockRejectedValue(new ApiRequestError(404, 'GUILD_BOT_MISSING'));
    await expect(getOverview(GUILD)).resolves.toEqual({ ok: false });
  });

  it('lets redirects, 404 signals and unexpected failures through', async () => {
    const signal = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' });
    server.fetch.mockRejectedValue(signal);
    await expect(getOverview(GUILD)).rejects.toBe(signal);
  });

  it('renders not-found for a server id that is not a snowflake, without calling the server', async () => {
    await expect(getOverview('..%2F..%2Fme%2Fx')).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(server.fetch).not.toHaveBeenCalled();
  });
});
