import { describe, expect, it, vi } from 'vitest';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';

const GUILD = '300000000000000001';
const USER = '300000000000000010';
const ROLE_A = '300000000000000021';
const ROLE_B = '300000000000000022';
const UNVERIFIED = '300000000000000023';

const refusal = () =>
  Object.assign(new Error('Missing Permissions'), { code: 50013, name: 'DiscordAPIError' });

type Setup = { has?: string[]; refuse?: string[]; memberError?: Error };

function setup(options: Setup = {}) {
  const calls: string[] = [];
  const refuse = new Set(options.refuse ?? []);
  const member = {
    roles: {
      cache: new Map((options.has ?? []).map((id) => [id, {}])),
      add: vi.fn((arg: unknown) => {
        calls.push(`add:${String(arg)}`);
        return refuse.has(String(arg)) ? Promise.reject(refusal()) : Promise.resolve(undefined);
      }),
      remove: vi.fn((arg: unknown) => {
        calls.push(`remove:${String(arg)}`);
        return refuse.has(String(arg)) ? Promise.reject(refusal()) : Promise.resolve(undefined);
      }),
    },
  };
  const guild = {
    roles: { cache: new Map([ROLE_A, ROLE_B, UNVERIFIED].map((id) => [id, {}])) },
    members: {
      fetch: vi.fn(() =>
        options.memberError === undefined
          ? Promise.resolve(member)
          : Promise.reject(options.memberError),
      ),
    },
  };
  const client = { guilds: { fetch: vi.fn(() => Promise.resolve(guild)) } };
  const service = new EmailVerifyDiscordService(
    client as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, member, calls };
}

describe('grantRoles', () => {
  it('changes one role per call, because an array makes discord.js overwrite the whole role list', async () => {
    const { service, member, calls } = setup({ has: [UNVERIFIED] });
    const result = await service.grantRoles(GUILD, USER, {
      add: [ROLE_A, ROLE_B],
      remove: [UNVERIFIED],
    });
    // Gave first, took away after.
    expect(calls).toEqual([`add:${ROLE_A}`, `add:${ROLE_B}`, `remove:${UNVERIFIED}`]);
    for (const call of [...member.roles.add.mock.calls, ...member.roles.remove.mock.calls]) {
      expect(typeof call[0]).toBe('string');
    }
    expect(result).toEqual({
      added: [ROLE_A, ROLE_B],
      removed: [UNVERIFIED],
      refused: [],
      failure: null,
      memberGone: false,
    });
  });

  it('skips roles the member already has and roles that no longer exist', async () => {
    const { service, calls } = setup({ has: [ROLE_A] });
    const result = await service.grantRoles(GUILD, USER, {
      add: [ROLE_A, ROLE_B, '300000000000000099'],
    });
    expect(calls).toEqual([`add:${ROLE_B}`]);
    expect(result.added).toEqual([ROLE_B]);
  });

  it('reports each refused role and still gives the others', async () => {
    const { service, calls } = setup({ has: [UNVERIFIED], refuse: [ROLE_A] });
    const result = await service.grantRoles(GUILD, USER, {
      add: [ROLE_A, ROLE_B],
      remove: [UNVERIFIED],
    });
    expect(calls).toEqual([`add:${ROLE_A}`, `add:${ROLE_B}`, `remove:${UNVERIFIED}`]);
    expect(result).toMatchObject({
      added: [ROLE_B],
      removed: [UNVERIFIED],
      refused: [ROLE_A],
      failure: 'Missing Permissions',
    });
  });

  it('keeps the unverified role when every role to give was refused', async () => {
    const { service, calls } = setup({ has: [UNVERIFIED], refuse: [ROLE_A, ROLE_B] });
    const result = await service.grantRoles(GUILD, USER, {
      add: [ROLE_A, ROLE_B],
      remove: [UNVERIFIED],
    });
    expect(calls).toEqual([`add:${ROLE_A}`, `add:${ROLE_B}`]);
    expect(result.removed).toEqual([]);
    expect(result.refused).toEqual([ROLE_A, ROLE_B]);
  });

  it('reports a member who left, and an unexpected failure as a failure, never a throw', async () => {
    const gone = setup({
      memberError: Object.assign(new Error('Unknown Member'), { code: 10007 }),
    });
    await expect(gone.service.grantRoles(GUILD, USER, { add: [ROLE_A] })).resolves.toMatchObject({
      memberGone: true,
      failure: null,
    });
    const broken = setup({ memberError: new Error('socket hang up 1.2.3.4') });
    const result = await broken.service.grantRoles(GUILD, USER, { add: [ROLE_A] });
    expect(result).toMatchObject({
      refused: [ROLE_A],
      failure: 'Unexpected error',
      memberGone: false,
    });
  });
});
