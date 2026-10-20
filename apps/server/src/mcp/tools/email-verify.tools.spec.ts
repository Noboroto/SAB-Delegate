import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailListService } from '../../modules/email-verify/email-list.service.js';
import { EmailVerifyConfigService } from '../../modules/email-verify/email-verify-config.service.js';
import { EmailVerifyMembersService } from '../../modules/email-verify/email-verify-members.service.js';
import { HARNESS_GUILD, startMcp } from '../mcp.test-harness.js';
import { EMAIL_VERIFY_TOOLS } from './email-verify.tools.js';

const USER = '555555555555555551';
const LIST = '0190a000-0000-7000-8000-0000000000c1';

type Body = { data: Record<string, unknown> };

describe('email verification tools', () => {
  const config = {
    get: vi.fn(),
    patch: vi.fn(),
    rules: vi.fn(),
    setRules: vi.fn(),
    blocklist: vi.fn(),
    setBlocklist: vi.fn(),
  };
  const lists = {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    addEntries: vi.fn(),
    removeEntries: vi.fn(),
  };
  const members = { members: vi.fn(), manualVerify: vi.fn(), revoke: vi.fn() };
  let mcp: Awaited<ReturnType<typeof startMcp>>;

  const start = async (mode: 'READ' | 'WRITE' = 'WRITE') => {
    mcp = await startMcp({
      rows: EMAIL_VERIFY_TOOLS,
      mode,
      services: new Map<Type, unknown>([
        [EmailVerifyConfigService, config],
        [EmailListService, lists],
        [EmailVerifyMembersService, members],
      ]),
    });
  };

  beforeEach(() => {
    for (const service of [config, lists, members]) {
      for (const fn of Object.values(service)) fn.mockReset();
    }
  });
  afterEach(async () => {
    await mcp.close();
  });

  it('shows a READ key only the read tools, and no tool for SMTP, mail or export', async () => {
    await start('READ');
    expect([...mcp.registeredTools].sort()).toEqual([
      'email_list_list',
      'email_verify_blocklist_get',
      'email_verify_config_get',
      'email_verify_members_list',
      'email_verify_rules_get',
    ]);
    expect(
      EMAIL_VERIFY_TOOLS.map((row) => row.name).filter((name) =>
        /smtp|(^|_)mail(_|$)|export|test/.test(name),
      ),
    ).toEqual([]);
  });

  it('config_set passes only the given fields and honours dryRun', async () => {
    await start();
    config.patch.mockResolvedValue({ enabled: true });
    await mcp.call('email_verify_config_set', {
      guildId: HARNESS_GUILD,
      enabled: true,
      dryRun: true,
    });
    expect(config.patch).toHaveBeenCalledWith(
      HARNESS_GUILD,
      { enabled: true },
      expect.objectContaining({ source: 'MCP' }),
      { dryRun: true },
    );
  });

  it('rules_set hands the rules to the service as given', async () => {
    await start();
    config.setRules.mockResolvedValue({ rules: [] });
    const rules = [
      {
        roleIds: [USER],
        condition: {
          combinator: 'or',
          rules: [{ field: 'domain', operator: '=', value: '*.edu' }],
        },
      },
    ];
    const reply = await mcp.call('email_verify_rules_set', { guildId: HARNESS_GUILD, rules });
    expect(reply.failed).toBe(false);
    expect(config.setRules).toHaveBeenCalledWith(
      HARNESS_GUILD,
      { rules: expect.any(Array) as unknown },
      expect.anything(),
      { dryRun: false },
    );
  });

  it('members_list never carries an address and wraps names as untrusted', async () => {
    await start();
    members.members.mockResolvedValue({
      items: [
        {
          userId: USER,
          domain: 'example.test',
          method: 'CODE',
          email: 'a@example.test',
          displayName: 'An',
          verifiedAt: '2026-10-21T00:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1 },
    });
    const reply = await mcp.call('email_verify_members_list', { guildId: HARNESS_GUILD });
    expect(members.members).toHaveBeenCalledWith(HARNESS_GUILD, expect.anything(), {
      withEmail: false,
    });
    expect(JSON.stringify(reply.json())).not.toContain('a@example.test');
    const items = (reply.json() as Body).data['items'] as { displayName: unknown }[];
    expect(items[0]?.displayName).toEqual({ untrusted: true, text: 'An' });
  });

  it('member_verify does not echo the address', async () => {
    await start();
    members.manualVerify.mockResolvedValue({
      member: {
        userId: USER,
        domain: 'example.test',
        method: 'MANUAL',
        email: 'a@example.test',
        displayName: null,
        verifiedAt: '2026-10-21T00:00:00.000Z',
      },
      grant: null,
    });
    const reply = await mcp.call('email_verify_member_verify', {
      guildId: HARNESS_GUILD,
      userId: USER,
      email: 'a@example.test',
    });
    expect(JSON.stringify(reply.json())).not.toContain('a@example.test');
    expect(members.manualVerify).toHaveBeenCalled();
  });

  it('list delete and member revoke refuse to run without a confirmation', async () => {
    await start();
    const deleted = await mcp.call('email_list_delete', { guildId: HARNESS_GUILD, listId: LIST });
    const revoked = await mcp.call('email_verify_member_revoke', {
      guildId: HARNESS_GUILD,
      userId: USER,
    });
    expect(lists.delete).not.toHaveBeenCalled();
    expect(members.revoke).not.toHaveBeenCalled();
    expect(deleted.text).toContain('Refused');
    expect(revoked.text).toContain('Refused');
  });
});
