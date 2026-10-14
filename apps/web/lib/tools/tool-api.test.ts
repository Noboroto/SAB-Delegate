import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/api-fetch', () => ({ apiFetch }));

import { getTool, postTool } from './tool-api';

const parser = { parse: (input: unknown) => input };
const GUILD = '1'.repeat(18);

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true });
});

describe('postTool', () => {
  it('posts the body to the guild route', async () => {
    await postTool(GUILD, 'purge', { a: 1 }, parser);
    expect(apiFetch).toHaveBeenCalledWith(`/api/guilds/${GUILD}/purge`, {
      method: 'POST',
      body: { a: 1 },
      parser,
    });
  });
});

describe('getTool', () => {
  it('encodes the query and leaves out absent values', async () => {
    await getTool(
      GUILD,
      'info/role-members',
      { roleId: '5', channelId: undefined, q: 'a b' },
      parser,
    );
    expect(apiFetch).toHaveBeenCalledWith(`/api/guilds/${GUILD}/info/role-members?roleId=5&q=a+b`, {
      parser,
    });
  });

  it('never calls the server for an id that is not a snowflake', () => {
    expect(() => getTool('..%2Fme', 'info/role-members', {}, parser)).toThrow();
    expect(() => postTool('x/../y', 'purge', {}, parser)).toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
