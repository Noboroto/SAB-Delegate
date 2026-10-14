import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRoles } from './use-roles';

const GUILD = '1'.repeat(18);
const role = { id: '3'.repeat(18), name: 'Mod', color: 0, position: 4, managed: false };

describe('useRoles', () => {
  it('reads the roles route of the server and parses them', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify([role]))));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRoles(GUILD));
    await waitFor(() => expect(result.current.data).toEqual([role]));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/discord/roles`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a role the shared schema does not describe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify([{ ...role, managed: 'yes' }])))),
    );
    const { result } = renderHook(() => useRoles(GUILD));
    await waitFor(() => expect(result.current.error).toBeDefined());
  });
});
