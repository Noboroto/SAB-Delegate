import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverFetch = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
vi.mock('@/lib/api/server-fetch', () => ({ serverFetch }));

import { getAuditLogs } from './get-audit-logs';

const GUILD = '1'.repeat(18);

beforeEach(() => serverFetch.mockReset());

describe('getAuditLogs', () => {
  it('leaves the action and source filters to the server', async () => {
    serverFetch.mockResolvedValue({ items: [], nextCursor: null });
    await getAuditLogs(GUILD, { action: 'note.upsert', source: 'MCP' });
    await getAuditLogs(GUILD, {});
    expect(serverFetch.mock.calls.map(([path]) => path)).toEqual([
      `/api/guilds/${GUILD}/audit-logs?limit=20&action=note.upsert&source=MCP`,
      `/api/guilds/${GUILD}/audit-logs?limit=20`,
    ]);
  });
});
